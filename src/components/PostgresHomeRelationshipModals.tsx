import type { Dispatch, FormEvent, SetStateAction } from "react";
import type {
  PostgresRelationshipAttributeDefinition,
  PostgresRelationshipType,
} from "../lib/postgres";
import {
  PostgresRelationshipModal,
  type PostgresRelationshipEndpointOption,
  type PostgresRelationshipModalTab,
} from "./PostgresRelationshipModal";

type RelationshipDraftModalProps = {
  relationshipTypes: PostgresRelationshipType[];
  relationshipTypeId: string;
  setRelationshipTypeId: Dispatch<SetStateAction<string>>;
  selectedType: PostgresRelationshipType | null;
  fromEndpointKey: string;
  setFromEndpointKey: Dispatch<SetStateAction<string>>;
  toEndpointKey: string;
  setToEndpointKey: Dispatch<SetStateAction<string>>;
  availableFromEndpoints: PostgresRelationshipEndpointOption[];
  availableToEndpoints: PostgresRelationshipEndpointOption[];
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  lineShapeOverride: string;
  setLineShapeOverride: Dispatch<SetStateAction<string>>;
  lineWeightOverride: number | null;
  setLineWeightOverride: Dispatch<SetStateAction<number | null>>;
  arrowheadOverride: string;
  setArrowheadOverride: Dispatch<SetStateAction<string>>;
  colorOverride: string;
  setColorOverride: Dispatch<SetStateAction<string>>;
  attributeDefinitions: PostgresRelationshipAttributeDefinition[];
  attributeValues: Record<string, string>;
  setAttributeValues: Dispatch<SetStateAction<Record<string, string>>>;
  submitDisabled: boolean;
};

export function PostgresHomeRelationshipModals(props: {
  createOpen: boolean;
  editingRelationshipId: string | null;
  createTab: PostgresRelationshipModalTab;
  setCreateTab: Dispatch<SetStateAction<PostgresRelationshipModalTab>>;
  editTab: PostgresRelationshipModalTab;
  setEditTab: Dispatch<SetStateAction<PostgresRelationshipModalTab>>;
  submitting: boolean;
  error?: string | null;
  createDraft: RelationshipDraftModalProps;
  editDraft: RelationshipDraftModalProps;
  onCloseCreate: () => void;
  onCloseEdit: () => void;
  onCreateSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onEditSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onNewRelationshipTypeFromCreate: () => void;
  onNewRelationshipTypeFromEdit: () => void;
}) {
  return (
    <>
      {props.createOpen ? (
        <PostgresRelationshipModal
          title="Create relationship"
          ariaLabel="Create relationship tabs"
          tab={props.createTab}
          setTab={props.setCreateTab}
          submitLabel="Add relationship"
          relationshipTypes={props.createDraft.relationshipTypes}
          relationshipTypeId={props.createDraft.relationshipTypeId}
          setRelationshipTypeId={props.createDraft.setRelationshipTypeId}
          selectedType={props.createDraft.selectedType}
          fromEndpointKey={props.createDraft.fromEndpointKey}
          setFromEndpointKey={props.createDraft.setFromEndpointKey}
          toEndpointKey={props.createDraft.toEndpointKey}
          setToEndpointKey={props.createDraft.setToEndpointKey}
          availableFromEndpoints={props.createDraft.availableFromEndpoints}
          availableToEndpoints={props.createDraft.availableToEndpoints}
          description={props.createDraft.description}
          setDescription={props.createDraft.setDescription}
          lineShapeOverride={props.createDraft.lineShapeOverride}
          setLineShapeOverride={props.createDraft.setLineShapeOverride}
          lineWeightOverride={props.createDraft.lineWeightOverride}
          setLineWeightOverride={props.createDraft.setLineWeightOverride}
          arrowheadOverride={props.createDraft.arrowheadOverride}
          setArrowheadOverride={props.createDraft.setArrowheadOverride}
          colorOverride={props.createDraft.colorOverride}
          setColorOverride={props.createDraft.setColorOverride}
          attributeDefinitions={props.createDraft.attributeDefinitions}
          attributeValues={props.createDraft.attributeValues}
          setAttributeValues={props.createDraft.setAttributeValues}
          submitting={props.submitting}
          submitDisabled={props.createDraft.submitDisabled}
          onClose={props.onCloseCreate}
          onSubmit={props.onCreateSubmit}
          onNewRelationshipType={props.onNewRelationshipTypeFromCreate}
        />
      ) : null}
      {props.editingRelationshipId ? (
        <PostgresRelationshipModal
          title="Edit relationship"
          ariaLabel="Edit relationship tabs"
          tab={props.editTab}
          setTab={props.setEditTab}
          submitLabel="Save"
          relationshipTypes={props.editDraft.relationshipTypes}
          relationshipTypeId={props.editDraft.relationshipTypeId}
          setRelationshipTypeId={props.editDraft.setRelationshipTypeId}
          selectedType={props.editDraft.selectedType}
          fromEndpointKey={props.editDraft.fromEndpointKey}
          setFromEndpointKey={props.editDraft.setFromEndpointKey}
          toEndpointKey={props.editDraft.toEndpointKey}
          setToEndpointKey={props.editDraft.setToEndpointKey}
          availableFromEndpoints={props.editDraft.availableFromEndpoints}
          availableToEndpoints={props.editDraft.availableToEndpoints}
          description={props.editDraft.description}
          setDescription={props.editDraft.setDescription}
          lineShapeOverride={props.editDraft.lineShapeOverride}
          setLineShapeOverride={props.editDraft.setLineShapeOverride}
          lineWeightOverride={props.editDraft.lineWeightOverride}
          setLineWeightOverride={props.editDraft.setLineWeightOverride}
          arrowheadOverride={props.editDraft.arrowheadOverride}
          setArrowheadOverride={props.editDraft.setArrowheadOverride}
          colorOverride={props.editDraft.colorOverride}
          setColorOverride={props.editDraft.setColorOverride}
          attributeDefinitions={props.editDraft.attributeDefinitions}
          attributeValues={props.editDraft.attributeValues}
          setAttributeValues={props.editDraft.setAttributeValues}
          submitting={props.submitting}
          error={props.error}
          submitDisabled={props.editDraft.submitDisabled}
          onClose={props.onCloseEdit}
          onSubmit={props.onEditSubmit}
          onNewRelationshipType={props.onNewRelationshipTypeFromEdit}
        />
      ) : null}
    </>
  );
}
