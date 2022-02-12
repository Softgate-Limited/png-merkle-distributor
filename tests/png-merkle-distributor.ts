import type {Program} from "@project-serum/anchor";
import {BN, workspace} from "@project-serum/anchor";
import {createAssociatedTokenAccount, getAssociatedTokenAddress,} from "@project-serum/associated-token";
import {createMintInstructions, getTokenAccount,} from "@project-serum/common";
import {mintTo, TOKEN_PROGRAM_ID} from "@project-serum/serum/lib/token-instructions";
import {Keypair, PublicKey, SystemProgram, Transaction,} from "@solana/web3.js";
import {BalanceTree, toBytes32Array} from "../src/utils";
import assert from "assert";

const program: Program = workspace.PngMerkleDistributor;
const [provider, payer] = [program.provider, program.provider.wallet.publicKey];

const MAX_NUM_NODES = new BN(3);
const MAX_TOTAL_CLAIM = new BN(1_000_000_000_000);
const airDropMintKeypair = Keypair.generate();
const dropKeypair = Keypair.generate();
const creatorKeypair = Keypair.generate();
const airDropMint = airDropMintKeypair.publicKey;
const airDropMintDecimals = 6;
let bump: number;
let distributor, distributorHolder: PublicKey;
const kpOne = Keypair.generate();
const kpTwo = Keypair.generate();
const kpThree = Keypair.generate();
describe("merkle-distributor", () => {
    context("claim", () => {
        it("init", async () => {
            await provider.send(
                new Transaction().add(
                    ...(await createMintInstructions(
                        provider,
                        payer,
                        airDropMint,
                        airDropMintDecimals
                    )),
                    await createAssociatedTokenAccount(
                        payer,
                        payer,
                        airDropMint
                    ),
                ),
                [airDropMintKeypair]
            );
        })

        it("success on three account tree", async () => {
            const allKps = [kpOne, kpTwo, kpThree];
            await Promise.all(
                allKps.map(async (kp) => {
                    await provider.connection.requestAirdrop(kp.publicKey, 10e9);
                })
            );
            const claimAmountOne = new BN(100);
            const claimAmountTwo = new BN(101);
            const claimAmountThree = new BN(102);
            const tree = new BalanceTree([
                {account: kpOne.publicKey, amount: claimAmountOne},
                {account: kpTwo.publicKey, amount: claimAmountTwo},
                {account: kpThree.publicKey, amount: claimAmountThree},
            ]);
            const root = tree.getRoot()
            const maxNumNodes = MAX_NUM_NODES;
            const maxTotalClaim = MAX_TOTAL_CLAIM;

            [distributor, bump] = await PublicKey.findProgramAddress(
                [Buffer.from("MerkleDistributor"), creatorKeypair.publicKey.toBuffer()],
                program.programId
            );

            await program.rpc.newDistributor(
                new BN(bump),
                toBytes32Array(root),
                new BN(maxTotalClaim),
                new BN(maxNumNodes),
                {
                    accounts: {
                        base: creatorKeypair.publicKey,
                        distributor: distributor,
                        mint: airDropMint,
                        payer: provider.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    },
                    signers: [creatorKeypair],
                }
            );

            const distributorAcc = await program.account.merkleDistributor.fetch(distributor);
            assert(distributorAcc.maxTotalClaim.eq(maxTotalClaim));
            assert(distributorAcc.maxNumNodes.eq(maxNumNodes));
            distributorHolder = await getAssociatedTokenAddress(distributor, airDropMint)

            await provider.send(
                new Transaction().add(
                    await createAssociatedTokenAccount(
                        payer,
                        dropKeypair.publicKey,
                        airDropMint
                    ),
                    await createAssociatedTokenAccount(
                        payer,
                        distributor,
                        airDropMint
                    ),
                    mintTo({
                        mint: airDropMint,
                        mintAuthority: payer,
                        destination: distributorHolder,
                        amount: maxTotalClaim,
                    }),
                )
            );
            const rewardsHolderAccAfter = await getTokenAccount(
                provider,
                distributorHolder,
            );
            assert(
                rewardsHolderAccAfter.amount
                    .eq(maxTotalClaim),
            );

            await Promise.all(
                allKps.map(async (kp, index) => {
                    const amount = new BN(100 + index);
                    const proof = tree.getProof(index, kp.publicKey, amount);

                    let [claimStatus, claimNonce] = await PublicKey.findProgramAddress(
                        [Buffer.from("ClaimStatus"), new BN(index).toArrayLike(Buffer, "le", 8), distributor.toBuffer()],
                        program.programId
                    );

                    await provider.send(
                        new Transaction().add(
                            await createAssociatedTokenAccount(
                                payer,
                                kp.publicKey,
                                airDropMint
                            )
                        )
                    )
                    const toHolder = await getAssociatedTokenAddress(kp.publicKey, airDropMint)
                    await program.rpc.claim(
                        new BN(claimNonce),
                        new BN(index),
                        amount,
                        proof.map((p) => toBytes32Array(p)),
                        {
                            accounts: {
                                distributor,
                                claimStatus,
                                from: distributorHolder,
                                to: toHolder,
                                claimant: kp.publicKey,
                                payer,
                                systemProgram: SystemProgram.programId,
                                tokenProgram: TOKEN_PROGRAM_ID,
                            },
                            signers: [kp],
                        }
                    );

                    const toHolderAfter = await getTokenAccount(
                        provider,
                        toHolder,
                    );
                    const claimStatusAcc = await program.account.claimStatus.fetch(claimStatus);

                    assert(toHolderAfter.amount.eq(amount));
                    assert(claimStatusAcc.amount.eq(amount));
                })
            );

        });

        it("add airdrop each 10", async () => {
            const updateAllKps = [kpOne, kpTwo, kpThree];
            await Promise.all(
                updateAllKps.map(async (kp) => {
                    await provider.connection.requestAirdrop(kp.publicKey, 10e9);
                })
            );
            const claimAmountOne = new BN(110);
            const claimAmountTwo = new BN(111);
            const claimAmountThree = new BN(112);
            const updateTree = new BalanceTree([
                {account: kpOne.publicKey, amount: claimAmountOne},
                {account: kpTwo.publicKey, amount: claimAmountTwo},
                {account: kpThree.publicKey, amount: claimAmountThree},
            ]);
            const root = updateTree.getRoot()
            const maxNumNodes = MAX_NUM_NODES;
            const maxTotalClaim = MAX_TOTAL_CLAIM;

            await program.rpc.updateDistributor(
                toBytes32Array(root),
                new BN(maxTotalClaim),
                new BN(maxNumNodes),
                {
                    accounts: {
                        base: creatorKeypair.publicKey,
                        distributor: distributor,
                        payer: provider.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    },
                    signers: [creatorKeypair],
                }
            );
            const distributorAcc = await program.account.merkleDistributor.fetch(distributor);

            assert.equal(distributorAcc.root.toString(), toBytes32Array(root).toString());

            await Promise.all(
                updateAllKps.map(async (kp, index) => {
                    const amount = new BN(110 + index);
                    const proof = updateTree.getProof(index, kp.publicKey, amount);

                    const [claimStatus, claimNonce] = await PublicKey.findProgramAddress(
                        [Buffer.from("ClaimStatus"), new BN(index).toArrayLike(Buffer, "le", 8), distributor.toBuffer()],
                        program.programId
                    );

                    const toHolder = await getAssociatedTokenAddress(kp.publicKey, airDropMint)
                    const toHolderBefore = await getTokenAccount(
                        provider,
                        toHolder,
                    );
                    await program.rpc.claim(
                        new BN(claimNonce),
                        new BN(index),
                        amount,
                        proof.map((p) => toBytes32Array(p)),
                        {
                            accounts: {
                                distributor,
                                claimStatus,
                                from: distributorHolder,
                                to: toHolder,
                                claimant: kp.publicKey,
                                payer,
                                systemProgram: SystemProgram.programId,
                                tokenProgram: TOKEN_PROGRAM_ID,
                            },
                            signers: [kp],
                        }
                    );

                    const toHolderAfter = await getTokenAccount(
                        provider,
                        toHolder,
                    );

                    assert(toHolderAfter.amount.eq(amount));
                    assert(toHolderAfter.amount.sub(toHolderBefore.amount).eq(new BN(10)));
                })
            );
        })
    });
});
