export type StageId = 1 | 2 | 3;

export interface GroundingSource {
  title: string;
  uri: string;
}

export type AttachmentKind = 'text' | 'image' | 'video';

export interface BrainstormAttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
  sizeBytes: number;
}

export interface BrainstormAttachmentPayload extends BrainstormAttachmentMeta {
  textContent?: string;
  base64Data?: string;
}

export interface BrainstormDirection {
  id: string;
  title: string;
  angle: string;
  hook: string;
  audience: string;
  verifiedFacts?: string;
}

export interface MainChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachments?: BrainstormAttachmentMeta[];
  directions?: BrainstormDirection[];
  groundingSources?: GroundingSource[];
}

export interface BranchMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  groundingSources?: GroundingSource[];
}

export interface BranchTab {
  id: string;
  directionId: string;
  title: string;
  initialAngle: string;
  initialHook: string;
  messages: BranchMessage[];
  coreConclusion: string;
  isLocked?: boolean;
}

export interface RiskDataSkepticism {
  claim: string;
  issue: string;
  suggestion: string;
}

export interface RiskComplianceItem {
  point: string;
  severity: 'high' | 'medium' | 'low';
  fix: string;
}

export interface RiskHookVulnerability {
  flaw: string;
  rewriteSuggestion: string;
}

export interface RiskAuditReport {
  id: string;
  generatedAt: string;
  summary: string;
  dataSkepticism: RiskDataSkepticism[];
  complianceRisks: RiskComplianceItem[];
  hookVulnerabilities: RiskHookVulnerability[];
  groundingSources?: GroundingSource[];
}

export interface ProjectBrief {
  lockedAt: string;
  branchId: string;
  branchTitle: string;
  topic: string;
  coreThesis: string;
  targetAudience: string;
  hookStrategy: string;
  keyPoints: string[];
  riskNotes: string;
}

export interface ScriptEditRecord {
  id: string;
  timestamp: string;
  instruction: string;
  original: string;
  replacement: string;
}

export interface ShotDialogueMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  shotSize: string;
  durationSec: number;
  visualDescription: string;
  dialogue: string;
  baseMjPrompt: string;
  cameraMovement: string;
  styleNote?: string;
  dialogueHistory?: ShotDialogueMessage[];
}

export interface VisualLockPreset {
  id: string;
  label: string;
  shortLabel: string;
  aspectRatio: '9:16' | '16:9';
  suffix: string;
  description: string;
}

export interface Project {
  id: string;
  name: string;
  platform: string;
  topic: string;
  currentStage: StageId;
  updatedAt: string;
  stage1: {
    searchGroundingEnabled: boolean;
    messages: MainChatMessage[];
    branches: BranchTab[];
    activeBranchId: string | null;
    riskAudit: RiskAuditReport | null;
  };
  stage2: {
    brief: ProjectBrief | null;
    scriptContent: string;
    editHistory: ScriptEditRecord[];
    candidateScripts?: Array<{
      id: string;
      versionName: string;
      hookType: string;
      estimatedDuration: string;
      highlight: string;
      scriptText: string;
    }>;
    activeCandidateId?: string;
  };
  stage3: {
    activeVisualLockId: string | null;
    customVisualLockSuffix: string;
    shots: StoryboardShot[];
  };
}

export type ChatbotPersonaId = 'script-coach' | 'visual-director' | 'algorithm-auditor';

export type ChatbotModelMode =
  | 'flash'
  | 'hydrogen'
  | 'argon'
  | 'fast'
  | 'deep'
  | 'complex'
  | 'general';

export type BuiltinGeminiModelId =
  | 'gemini-3.8-flash'
  | 'gemini-4-hydrogen'
  | 'gemini-4-argon'
  | 'gemini-3.1-flash-lite';

export interface ApiErrorDetail {
  title: string;
  statusCode: number;
  statusText?: string;
  message: string;
  rawDetails?: string;
  modelUsed?: string;
}

export interface ModelFallbackNotice {
  originalModel: string;
  fallbackModel: string;
  message: string;
  timestamp: number;
}

export interface ChatbotMessage {
  id: string;
  projectId: string;
  role: 'user' | 'model';
  personaId: string;
  modelName: string;
  content: string;
  createdAt: string;
}

export type ApiProviderType =
  | 'builtin-gemini'
  | 'deepseek'
  | 'openai'
  | 'claude'
  | 'custom-openai';

export interface ApiProviderConfig {
  providerType: ApiProviderType;
  presetId: 'gemini' | 'deepseek' | 'openai' | 'claude' | 'custom';
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type CloudFileSource = 'google-drive' | 'webdav';

export interface CloudFileItem {
  id: string;
  source: CloudFileSource;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAt?: string;
  kind: AttachmentKind;
  downloadRef: string;
}

export type SaveDestinationMode = 'local-browser' | 'local-folder' | 'google-drive' | 'webdav' | 'cloud-sync';

export interface SaveDestinationConfig {
  mode: SaveDestinationMode;
  folderLabel: string;
  localFolderPath?: string;
  autoSaveLocalFolder?: boolean;
  googleDriveFolder?: string;
  googleDriveAutoSync?: boolean;
  googleDriveCustomToken?: string;
  webdavUrl: string;
  webdavPath: string;
  webdavUsername: string;
  webdavPassword: string;
}

export interface TokenUsageSummary {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  model: string;
}

export interface ApiUsageRecord {
  id: string;
  action: string;
  model: string;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  timestamp: string;
}

export interface ApiUsageStats {
  totalRequests: number;
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  warningThresholdTokens: number;
  budgetLimitTokens: number;
  lastUpdatedAt: string;
  recentRecords: ApiUsageRecord[];
}

