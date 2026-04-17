export const AGENT_REGISTRY_ABI = [
  'function registerAgent(string calldata did, string calldata publicKey, string calldata endpoint) external',
  'function updateAgent(string calldata did, string calldata publicKey, string calldata endpoint) external',
  'function deactivateAgent(string calldata did) external',
  'function getAgent(string calldata did) external view returns (tuple(address owner, string did, string publicKey, string endpoint, bool active, uint256 registeredAt))',
  'event AgentRegistered(bytes32 indexed agentId, address indexed owner, string did)',
  'event AgentUpdated(bytes32 indexed agentId, string publicKey, string endpoint)',
  'event AgentDeactivated(bytes32 indexed agentId)',
];
