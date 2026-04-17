// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ServiceCatalog {
    struct ServiceInfo {
        bytes32 agentId;
        string name;
        bytes32 schemaHash;
        bool active;
        uint256 createdAt;
    }

    mapping(bytes32 => ServiceInfo) public services;

    event ServiceRegistered(bytes32 indexed serviceId, bytes32 indexed agentId, string name);
    event ServiceDeactivated(bytes32 indexed serviceId);

    function registerService(
        string calldata agentDid,
        string calldata name,
        bytes32 schemaHash
    ) external {
        bytes32 agentId = keccak256(abi.encodePacked(agentDid));
        bytes32 serviceId = keccak256(abi.encodePacked(agentDid, name));
        require(services[serviceId].createdAt == 0, "Service already exists");

        services[serviceId] = ServiceInfo({
            agentId: agentId,
            name: name,
            schemaHash: schemaHash,
            active: true,
            createdAt: block.timestamp
        });

        emit ServiceRegistered(serviceId, agentId, name);
    }

    function deactivateService(bytes32 serviceId) external {
        require(services[serviceId].active, "Service not active");
        services[serviceId].active = false;

        emit ServiceDeactivated(serviceId);
    }
}
