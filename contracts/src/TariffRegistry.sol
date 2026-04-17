// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TariffRegistry {
    struct TariffInfo {
        bytes32 agentId;
        bytes32 serviceId;
        bytes32 tariffHash;
        string metadataUri;
        uint256 createdAt;
    }

    mapping(bytes32 => TariffInfo) public tariffs;

    event TariffPublished(bytes32 indexed tariffId, bytes32 indexed agentId, bytes32 indexed serviceId);

    function publishTariff(
        string calldata agentDid,
        bytes32 serviceId,
        bytes32 tariffHash,
        string calldata metadataUri
    ) external {
        bytes32 agentId = keccak256(abi.encodePacked(agentDid));
        bytes32 tariffId = keccak256(abi.encodePacked(agentId, serviceId, tariffHash));
        require(tariffs[tariffId].createdAt == 0, "Tariff already exists");

        tariffs[tariffId] = TariffInfo({
            agentId: agentId,
            serviceId: serviceId,
            tariffHash: tariffHash,
            metadataUri: metadataUri,
            createdAt: block.timestamp
        });

        emit TariffPublished(tariffId, agentId, serviceId);
    }
}
