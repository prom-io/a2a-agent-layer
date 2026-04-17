// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";
import "../src/ServiceCatalog.sol";
import "../src/TariffRegistry.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        AgentRegistry agentRegistry = new AgentRegistry();
        ServiceCatalog serviceCatalog = new ServiceCatalog();
        TariffRegistry tariffRegistry = new TariffRegistry();

        console.log("AgentRegistry deployed at:", address(agentRegistry));
        console.log("ServiceCatalog deployed at:", address(serviceCatalog));
        console.log("TariffRegistry deployed at:", address(tariffRegistry));

        vm.stopBroadcast();
    }
}
