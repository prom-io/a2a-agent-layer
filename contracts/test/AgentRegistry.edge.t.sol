// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/AgentRegistry.sol";

contract AgentRegistryEdgeTest is Test {
    AgentRegistry public registry;
    address public owner = address(0x1);
    address public attacker = address(0x2);
    address public stranger = address(0x3);

    event AgentRegistered(bytes32 indexed agentId, address indexed owner, string did);
    event AgentUpdated(bytes32 indexed agentId, string publicKey, string endpoint);
    event AgentDeactivated(bytes32 indexed agentId);

    function setUp() public {
        registry = new AgentRegistry();
    }

    function test_RevertWhen_DuplicateRegistration() public {
        vm.prank(owner);
        registry.registerAgent("did:prom:dup", "pk", "https://a.example");

        vm.prank(attacker);
        vm.expectRevert("Agent already registered");
        registry.registerAgent("did:prom:dup", "pk2", "https://b.example");
    }

    function test_RevertWhen_DuplicateRegistrationSameOwner() public {
        vm.startPrank(owner);
        registry.registerAgent("did:prom:dup", "pk", "https://a.example");
        vm.expectRevert("Agent already registered");
        registry.registerAgent("did:prom:dup", "pk2", "https://b.example");
        vm.stopPrank();
    }

    function test_RevertWhen_UpdateByStranger() public {
        vm.prank(owner);
        registry.registerAgent("did:prom:secure", "pk", "https://a.example");

        vm.prank(stranger);
        vm.expectRevert("Not agent owner");
        registry.updateAgent("did:prom:secure", "pk2", "https://evil.example");
    }

    function test_RevertWhen_UpdateNonExistentAgent() public {
        vm.prank(owner);
        vm.expectRevert("Not agent owner");
        registry.updateAgent("did:prom:ghost", "pk", "https://ghost.example");
    }

    function test_RevertWhen_UpdateAfterDeactivation() public {
        vm.startPrank(owner);
        registry.registerAgent("did:prom:lifecycle", "pk", "https://a.example");
        registry.deactivateAgent("did:prom:lifecycle");
        vm.expectRevert("Agent is not active");
        registry.updateAgent("did:prom:lifecycle", "pk2", "https://b.example");
        vm.stopPrank();
    }

    function test_RevertWhen_DeactivateTwice() public {
        vm.startPrank(owner);
        registry.registerAgent("did:prom:dd", "pk", "https://a.example");
        registry.deactivateAgent("did:prom:dd");
        vm.expectRevert("Agent already inactive");
        registry.deactivateAgent("did:prom:dd");
        vm.stopPrank();
    }

    function test_DistinctDidsMapToDistinctIds() public {
        vm.startPrank(owner);
        registry.registerAgent("did:prom:alpha", "pkA", "https://alpha.example");
        registry.registerAgent("did:prom:beta", "pkB", "https://beta.example");
        vm.stopPrank();

        AgentRegistry.AgentInfo memory a = registry.getAgent("did:prom:alpha");
        AgentRegistry.AgentInfo memory b = registry.getAgent("did:prom:beta");
        assertEq(a.publicKey, "pkA");
        assertEq(b.publicKey, "pkB");
        assertFalse(keccak256(bytes(a.did)) == keccak256(bytes(b.did)));
    }

    function test_EmptyDidIsValidAtContractLevel() public {
        // The contract does not block empty DIDs; off-chain layer must enforce DID grammar.
        // This test pins the current behaviour so any future on-chain validation is intentional.
        vm.prank(owner);
        registry.registerAgent("", "pk", "https://a.example");

        AgentRegistry.AgentInfo memory info = registry.getAgent("");
        assertEq(info.owner, owner);
    }

    function testFuzz_OnlyOwnerCanUpdate(address randomCaller) public {
        vm.assume(randomCaller != owner);
        vm.assume(randomCaller != address(0));

        vm.prank(owner);
        registry.registerAgent("did:prom:fuzz", "pk", "https://a.example");

        vm.prank(randomCaller);
        vm.expectRevert("Not agent owner");
        registry.updateAgent("did:prom:fuzz", "pk2", "https://b.example");
    }

    function testFuzz_AgentIdDeterministic(string calldata did) public {
        vm.assume(bytes(did).length > 0 && bytes(did).length < 256);

        vm.prank(owner);
        registry.registerAgent(did, "pk", "https://a.example");

        AgentRegistry.AgentInfo memory info = registry.getAgent(did);
        assertEq(info.owner, owner);
        assertEq(keccak256(bytes(info.did)), keccak256(bytes(did)));
    }

    function test_EmitsRegisteredEventOnce() public {
        bytes32 expectedId = keccak256(abi.encodePacked("did:prom:evt"));

        vm.prank(owner);
        vm.expectEmit(true, true, false, true);
        emit AgentRegistered(expectedId, owner, "did:prom:evt");
        registry.registerAgent("did:prom:evt", "pk", "https://evt.example");
    }
}
