// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract AgentRegistry {
    struct AgentInfo {
        address owner;
        string did;
        string publicKey;
        string endpoint;
        bool active;
        uint256 registeredAt;
    }

    mapping(bytes32 => AgentInfo) public agents;

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, string did);
    event AgentUpdated(bytes32 indexed agentId, string publicKey, string endpoint);
    event AgentDeactivated(bytes32 indexed agentId);

    modifier onlyAgentOwner(string calldata did) {
        bytes32 agentId = keccak256(abi.encodePacked(did));
        require(agents[agentId].owner == msg.sender, "Not agent owner");
        _;
    }

    function registerAgent(
        string calldata did,
        string calldata publicKey,
        string calldata endpoint
    ) external {
        bytes32 agentId = keccak256(abi.encodePacked(did));
        require(agents[agentId].owner == address(0), "Agent already registered");

        agents[agentId] = AgentInfo({
            owner: msg.sender,
            did: did,
            publicKey: publicKey,
            endpoint: endpoint,
            active: true,
            registeredAt: block.timestamp
        });

        emit AgentRegistered(agentId, msg.sender, did);
    }

    function updateAgent(
        string calldata did,
        string calldata publicKey,
        string calldata endpoint
    ) external onlyAgentOwner(did) {
        bytes32 agentId = keccak256(abi.encodePacked(did));
        require(agents[agentId].active, "Agent is not active");

        agents[agentId].publicKey = publicKey;
        agents[agentId].endpoint = endpoint;

        emit AgentUpdated(agentId, publicKey, endpoint);
    }

    function deactivateAgent(string calldata did) external onlyAgentOwner(did) {
        bytes32 agentId = keccak256(abi.encodePacked(did));
        require(agents[agentId].active, "Agent already inactive");

        agents[agentId].active = false;

        emit AgentDeactivated(agentId);
    }

    function getAgent(string calldata did) external view returns (AgentInfo memory) {
        bytes32 agentId = keccak256(abi.encodePacked(did));
        require(agents[agentId].owner != address(0), "Agent not found");
        return agents[agentId];
    }
}
