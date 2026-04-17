// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TariffRegistry.sol";

contract TariffRegistryTest is Test {
    TariffRegistry public tariffRegistry;

    function setUp() public {
        tariffRegistry = new TariffRegistry();
    }

    function test_publishTariff() public {
        bytes32 serviceId = keccak256("service-1");
        bytes32 tariffHash = keccak256("tariff-data");

        tariffRegistry.publishTariff(
            "did:prom:agent1",
            serviceId,
            tariffHash,
            "ipfs://QmTariffMetadata"
        );

        bytes32 agentId = keccak256(abi.encodePacked("did:prom:agent1"));
        bytes32 tariffId = keccak256(abi.encodePacked(agentId, serviceId, tariffHash));

        (bytes32 storedAgentId, bytes32 storedServiceId, bytes32 storedHash, string memory uri, uint256 createdAt) =
            tariffRegistry.tariffs(tariffId);

        assertEq(storedAgentId, agentId);
        assertEq(storedServiceId, serviceId);
        assertEq(storedHash, tariffHash);
        assertEq(uri, "ipfs://QmTariffMetadata");
        assertGt(createdAt, 0);
    }
}
