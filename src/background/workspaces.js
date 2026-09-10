import { createInvestigationRepository } from "@isaiandco/ape-share-core/investigation/repository";
export const { listWorkspaces, getWorkspace, createInvestigation, updateWorkspace, deleteWorkspace,
  getWorkspaceAiChat, saveWorkspaceAiChat, importWorkspaceAiChat, removeWorkspaceItem, pinWorkspaceItem,
} = createInvestigationRepository({ databaseFactory: () => indexedDB, name: "apepatrol-investigations" });
