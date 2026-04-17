// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";

contract AgentRegistryTest is Test {
    AgentRegistry public registry;
    address public owner = address(1);
    address public other = address(2);

    function setUp() public {
        registry = new AgentRegistry();
    }

    function test_registerAgent() public {
        vm.prank(owner);
        registry.registerAgent("did:prom:agent1", "pk1", "https://agent1.example.com");

        AgentRegistry.AgentInfo memory info = registry.getAgent("did:prom:agent1");
        assertEq(info.owner, owner);
        assertEq(info.did, "did:prom:agent1");
        assertEq(info.publicKey, "pk1");
        assertEq(info.endpoint, "https://agent1.example.com");
        assertTrue(info.active);
    }

    function test_updateAgent_onlyOwner() public {
        vm.prank(owner);
        registry.registerAgent("did:prom:agent1", "pk1", "https://agent1.example.com");

        vm.prank(other);
        vm.expectRevert("Not agent owner");
        registry.updateAgent("did:prom:agent1", "pk2", "https://new.example.com");

        vm.prank(owner);
        registry.updateAgent("did:prom:agent1", "pk2", "https://new.example.com");

        AgentRegistry.AgentInfo memory info = registry.getAgent("did:prom:agent1");
        assertEq(info.publicKey, "pk2");
        assertEq(info.endpoint, "https://new.example.com");
    }

    function test_deactivateAgent() public {
        vm.prank(owner);
        registry.registerAgent("did:prom:agent1", "pk1", "https://agent1.example.com");

        vm.prank(owner);
        registry.deactivateAgent("did:prom:agent1");

        AgentRegistry.AgentInfo memory info = registry.getAgent("did:prom:agent1");
        assertFalse(info.active);
    }

    function test_getAgent_notFound() public {
        vm.expectRevert("Agent not found");
        registry.getAgent("did:prom:nonexistent");
    }
}
