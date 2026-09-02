import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftToLine,
  ArrowLeftRight,
  Bot,
  Box,
  Camera,
  Check,
  CircleQuestionMark,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  FileCog,
  Funnel,
  Globe,
  GlobeOff,
  ListRestart,
  LogOut,
  Minus,
  Plus,
  Play,
  Pause,
  RedoDot,
  Save,
  Scan,
  Search,
  SquareCode,
  SquarePen,
  Tag,
  Trash,
  UndoDot,
  Users,
  Volume1,
  VolumeX,
  Waypoints,
  Workflow,
  X,
  StepBack,
  StepForward,
} from "lucide-react";

export type IconProps = {
  className?: string;
};

export function LucideAppIcon({
  Icon,
  className,
}: IconProps & {
  Icon: LucideIcon;
}) {
  return <Icon aria-hidden="true" className={className} focusable="false" />;
}

export function HelpIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={CircleQuestionMark} className={className} />;
}

export function ArrowLeftIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={ArrowLeftToLine} className={className} />;
}

export function ArrowLeftRightIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={ArrowLeftRight} className={className} />;
}

export function ComputerIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={GlobeOff} className={className} />;
}

export function NetworkIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Globe} className={className} />;
}

export function CollaborationIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Users} className={className} />;
}

export function AiAssistIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Bot} className={className} />;
}

export function PlusIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Plus} className={className} />;
}

export function MinusIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Minus} className={className} />;
}

export function ZoomIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Search} className={className} />;
}

export function FitCornersIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Scan} className={className} />;
}

export function LayoutNetworkIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Waypoints} className={className} />;
}

export function CloseIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={X} className={className} />;
}

export function EditIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={SquarePen} className={className} />;
}

export function DeleteIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Trash} className={className} />;
}

export function CheckIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Check} className={className} />;
}

export function EyeIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Eye} className={className} />;
}

export function EyeOffIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={EyeOff} className={className} />;
}

export function LogoutIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={LogOut} className={className} />;
}

export function DownloadIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Download} className={className} />;
}

export function SaveIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Save} className={className} />;
}

export function ProcessTranscriptIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={FileCog} className={className} />;
}

export function SourceIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={SquareCode} className={className} />;
}

export function ObjectIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Box} className={className} />;
}

export function RelationshipIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Workflow} className={className} />;
}

export function CodeIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Tag} className={className} />;
}

export function FilterIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Funnel} className={className} />;
}

export function RestartListIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={ListRestart} className={className} />;
}

export function MediaZoomFitIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Scan} className={className} />;
}

export function NewClipIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Clapperboard} className={className} />;
}

export function ExtractFrameIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Camera} className={className} />;
}

export function PlayIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Play} className={className} />;
}

export function PauseIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={Pause} className={className} />;
}

export function BackFiveIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={UndoDot} className={className} />;
}

export function ForwardFiveIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={RedoDot} className={className} />;
}

export function StepBackIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={StepBack} className={className} />;
}

export function StepForwardIcon({ className }: IconProps) {
  return <LucideAppIcon Icon={StepForward} className={className} />;
}

export function VolumeIcon({ className, muted }: IconProps & { muted?: boolean }) {
  return <LucideAppIcon Icon={muted ? VolumeX : Volume1} className={className} />;
}
