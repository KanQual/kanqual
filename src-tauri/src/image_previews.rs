//! Disposable, bounded thumbnail cache. Original bytes never cross the JS bridge.
use super::*;
use image::ImageDecoder;
use std::time::{Instant, SystemTime};

const MAX_ENTRIES: usize = 128;
const MAX_BYTES: u64 = 64 * 1024 * 1024;
#[derive(Hash, Eq, PartialEq)]
struct Key {
    path: PathBuf,
    size: u32,
    len: u64,
    modified: SystemTime,
}
struct Entry {
    file: Arc<tempfile::NamedTempFile>,
    bytes: u64,
    used: Instant,
}
#[derive(Default)]
pub(super) struct ImagePreviewCache {
    entries: Mutex<HashMap<Key, Entry>>,
}
impl ImagePreviewCache {
    pub(super) fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
    #[cfg(test)]
    pub(super) fn thumbnail(
        &self,
        path: &Path,
        size: u32,
    ) -> Result<Arc<tempfile::NamedTempFile>, String> {
        self.thumbnail_with_cancel(path, size, None)
    }
    pub(super) fn thumbnail_with_cancel(
        &self,
        path: &Path,
        size: u32,
        alive: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<Arc<tempfile::NamedTempFile>, String> {
        let size = match size {
            0..=128 => 128,
            129..=384 => 384,
            _ => 1024,
        };
        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let key = Key {
            path: path.to_path_buf(),
            size,
            len: metadata.len(),
            modified: metadata.modified().map_err(|e| e.to_string())?,
        };
        // This lock also serializes decodes: only one full image is decoded at a time.
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "Thumbnail cache unavailable")?;
        if alive.is_some_and(|alive| !alive.load(std::sync::atomic::Ordering::Acquire)) {
            return Err("Image request cancelled".into());
        }
        if let Some(entry) = entries.get_mut(&key) {
            entry.used = Instant::now();
            return Ok(entry.file.clone());
        }
        entries.retain(|old, _| {
            old.path != key.path || (old.len == key.len && old.modified == key.modified)
        });
        let mut reader = image::ImageReader::open(path)
            .map_err(|e| e.to_string())?
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(256 * 1024 * 1024);
        reader.limits(limits);
        let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
        if decoder.total_bytes() > 256 * 1024 * 1024 {
            return Err(
                "Image exceeds the thumbnail decoder memory budget; open the original for coding."
                    .into(),
            );
        }
        let orientation = decoder.orientation().map_err(|e| e.to_string())?;
        let mut original = image::DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
        original.apply_orientation(orientation);
        let thumbnail = original.thumbnail(size.min(original.width()), size.min(original.height()));
        drop(original);
        let mut file = tempfile::Builder::new()
            .prefix("kanqual-preview-")
            .suffix(".png")
            .tempfile()
            .map_err(|e| e.to_string())?;
        thumbnail
            .write_to(&mut file, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
        let after = fs::metadata(path).map_err(|e| e.to_string())?;
        if after.len() != key.len || after.modified().map_err(|e| e.to_string())? != key.modified {
            return Err("Image changed while generating preview; retry.".into());
        }
        let bytes = file.as_file().metadata().map_err(|e| e.to_string())?.len();
        while !entries.is_empty()
            && (entries.len() >= MAX_ENTRIES
                || entries.values().map(|entry| entry.bytes).sum::<u64>() + bytes > MAX_BYTES)
        {
            let oldest = entries
                .iter()
                .min_by_key(|(_, entry)| entry.used)
                .map(|(key, _)| Key {
                    path: key.path.clone(),
                    size: key.size,
                    len: key.len,
                    modified: key.modified,
                })
                .unwrap();
            entries.remove(&oldest);
        }
        let file = Arc::new(file);
        entries.insert(
            key,
            Entry {
                file: file.clone(),
                bytes,
                used: Instant::now(),
            },
        );
        Ok(file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn fixture(path: &Path, width: u32, height: u32) {
        let image = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([
                (x % 251) as u8,
                (y % 241) as u8,
                ((x * 13 + y * 7) % 239) as u8,
            ])
        });
        image.save(path).unwrap();
    }
    fn oriented_jpeg(path: &Path) {
        fixture(path, 80, 40);
        let bytes = fs::read(path).unwrap();
        // Little-endian TIFF IFD, orientation 6 (90 degrees clockwise).
        let exif: [u8; 32] = [
            69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 18, 1, 3, 0, 1, 0, 0, 0, 6,
            0, 0, 0, 0, 0, 0, 0,
        ];
        let mut output = vec![0xff, 0xd8, 0xff, 0xe1, 0, 34];
        output.extend(exif);
        output.extend(&bytes[2..]);
        fs::write(path, output).unwrap();
    }
    #[test]
    fn thumbnails_preserve_originals_orientation_alpha_and_invalidate() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("original.jpg");
        oriented_jpeg(&path);
        let before = Sha256::digest(fs::read(&path).unwrap());
        let cache = ImagePreviewCache::default();
        let preview = cache.thumbnail(&path, 128).unwrap();
        let image = image::open(preview.path()).unwrap();
        assert_eq!((image.width(), image.height()), (40, 80));
        assert_eq!(before, Sha256::digest(fs::read(&path).unwrap()));
        assert!(Arc::ptr_eq(&preview, &cache.thumbnail(&path, 128).unwrap()));
        let future = SystemTime::now() + std::time::Duration::from_secs(2);
        fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(future)
            .unwrap();
        assert!(!Arc::ptr_eq(
            &preview,
            &cache.thumbnail(&path, 128).unwrap()
        ));
        let cancelled = std::sync::atomic::AtomicBool::new(false);
        assert!(cache
            .thumbnail_with_cancel(&path, 128, Some(&cancelled))
            .is_err());
        fixture(&path, 200, 100);
        let updated = cache.thumbnail(&path, 128).unwrap();
        assert_ne!(preview.path(), updated.path());
        assert_eq!(
            (
                image::open(updated.path()).unwrap().width(),
                image::open(updated.path()).unwrap().height()
            ),
            (128, 64)
        );
        let alpha = root.path().join("alpha.png");
        image::RgbaImage::from_pixel(300, 200, image::Rgba([200, 30, 10, 0]))
            .save(&alpha)
            .unwrap();
        assert_eq!(
            image::open(cache.thumbnail(&alpha, 128).unwrap().path())
                .unwrap()
                .to_rgba8()
                .get_pixel(0, 0)
                .0[3],
            0
        );
        fs::remove_file(&path).unwrap();
        assert!(cache.thumbnail(&path, 128).is_err());
        fs::write(&path, b"not an image").unwrap();
        assert!(cache.thumbnail(&path, 128).is_err());
    }
    #[test]
    fn cache_is_bounded_and_cleanup_deletes_temporary_files() {
        let root = tempfile::tempdir().unwrap();
        let cache = ImagePreviewCache::default();
        let path = root.path().join("image.png");
        fixture(&path, 64, 48);
        let first = cache.thumbnail(&path, 128).unwrap();
        let first_path = first.path().to_path_buf();
        drop(first);
        for i in 0..140 {
            let path = root.path().join(format!("{i}.png"));
            fixture(&path, 64, 48);
            cache.thumbnail(&path, 128).unwrap();
        }
        assert!(!first_path.exists());
        let entries = cache.entries.lock().unwrap();
        assert!(entries.len() <= MAX_ENTRIES);
        assert!(entries.values().map(|entry| entry.bytes).sum::<u64>() <= MAX_BYTES);
        let paths = entries
            .values()
            .map(|entry| entry.file.path().to_path_buf())
            .collect::<Vec<_>>();
        drop(entries);
        cache.clear();
        assert!(paths.iter().all(|path| !path.exists()));
    }
    #[test]
    #[ignore = "Run scripts/test-image-previews.mjs"]
    fn generate_browser_fixtures() {
        let root = PathBuf::from(std::env::var("KANQUAL_IMAGE_TEST_ROOT").unwrap());
        fs::create_dir_all(root.join("original")).unwrap();
        fs::create_dir_all(root.join("preview")).unwrap();
        for index in 0..24 {
            fixture(
                &root.join("original").join(format!("{index}.jpg")),
                3072,
                2048,
            );
        }
        let oriented = root.join("original/oriented.jpg");
        oriented_jpeg(&oriented);
        let cache = ImagePreviewCache::default();
        let start = Instant::now();
        for index in 0..24 {
            let preview = cache
                .thumbnail(&root.join("original").join(format!("{index}.jpg")), 384)
                .unwrap();
            fs::copy(
                preview.path(),
                root.join("preview").join(format!("{index}.png")),
            )
            .unwrap();
        }
        let cold = start.elapsed().as_secs_f64() * 1000.0;
        let start = Instant::now();
        for index in 0..24 {
            cache
                .thumbnail(&root.join("original").join(format!("{index}.jpg")), 384)
                .unwrap();
        }
        let hot = start.elapsed().as_secs_f64() * 1000.0;
        fs::copy(
            cache.thumbnail(&oriented, 128).unwrap().path(),
            root.join("preview/oriented.png"),
        )
        .unwrap();
        fs::write(root.join("native.json"),serde_json::json!({"images":24,"width":3072,"height":2048,"coldThumbnailMs":cold,"cachedThumbnailMs":hot,"cacheBytes":cache.entries.lock().unwrap().values().map(|entry|entry.bytes).sum::<u64>()}).to_string()).unwrap();
    }
}
