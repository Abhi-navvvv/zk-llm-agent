// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISP1Verifier {
    /**
     * @notice Verifies a proof of execution of a program under the SP1 zkVM.
     * @param programVKey The verification key (Image ID) of the guest program.
     * @param publicValues The public inputs/outputs committed by the guest program.
     * @param proofBytes The cryptographic proof bytes (e.g. Groth16 seal).
     */
    function verifyProof(
        bytes32 programVKey,
        bytes calldata publicValues,
        bytes calldata proofBytes
    ) external view;
}
