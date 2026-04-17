// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/ServiceCatalog.sol";

contract ServiceCatalogTest is Test {
    ServiceCatalog public catalog;

    function setUp() public {
        catalog = new ServiceCatalog();
    }

    function test_registerService() public {
        bytes32 schemaHash = keccak256("schema-v1");
        catalog.registerService("did:prom:agent1", "translation", schemaHash);

        bytes32 serviceId = keccak256(abi.encodePacked("did:prom:agent1", "translation"));
        (bytes32 agentId, string memory name, bytes32 storedHash, bool active, uint256 createdAt) =
            catalog.services(serviceId);

        assertEq(name, "translation");
        assertEq(storedHash, schemaHash);
        assertTrue(active);
        assertGt(createdAt, 0);
        assertEq(agentId, keccak256(abi.encodePacked("did:prom:agent1")));
    }

    function test_deactivateService() public {
        bytes32 schemaHash = keccak256("schema-v1");
        catalog.registerService("did:prom:agent1", "translation", schemaHash);

        bytes32 serviceId = keccak256(abi.encodePacked("did:prom:agent1", "translation"));
        catalog.deactivateService(serviceId);

        (, , , bool active, ) = catalog.services(serviceId);
        assertFalse(active);
    }
}
