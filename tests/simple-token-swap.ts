import * as anchor from "@project-serum/anchor";
import { Program, web3, BN } from "@project-serum/anchor";
import { PublicKey, Keypair } from '@solana/web3.js';
import { SimpleTokenSwap } from "../target/types/simple_token_swap";

import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import * as fs from "fs";
import {createToken, creatMintIfRequired, mintTo, supplyBalance, vaultBalance} from "./utils";

describe("simple-token-swap", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SimpleTokenSwap as Program<SimpleTokenSwap>;
  const provider = anchor.getProvider();
  const splProgram = anchor.Spl.token();

  const pool = Keypair.generate();
  const authority = Keypair.generate();

  // CQvrBGkz969f23jxXXKxMP2HKt3q9pD7fdmNKFvmfTE8
  // USDC on mainnet
  const mintVault = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync('tests/keys/mint_vault.json').toString())));

  // Bn7EFJXkK5uouriedPTVrLBJsTxLQ6DwTZf7iWxgH8d6
  // Staratlas tokens on mainnet
  const mintSupply = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync('tests/keys/mint_supply.json').toString())));

  const vaultFund = Keypair.generate();
  const supplyFund = Keypair.generate();

  before(async() => {
    await creatMintIfRequired(splProgram, mintVault, provider.wallet.publicKey);
    await creatMintIfRequired(splProgram, mintSupply, provider.wallet.publicKey);

    await createToken(splProgram, vaultFund, mintVault.publicKey, provider.wallet.publicKey);
    await createToken(splProgram, supplyFund, mintSupply.publicKey, provider.wallet.publicKey);

    await mintTo(splProgram, 1000_000_000_000, mintVault.publicKey, vaultFund.publicKey, provider.wallet.publicKey);
    await mintTo(splProgram, 1000_000_000_000, mintSupply.publicKey, supplyFund.publicKey, provider.wallet.publicKey);
  });

  it("Should init pool", async () => {
    //track cost of creating a pool
    const startLamports = await provider.connection.getBalance(provider.wallet.publicKey);

    await program.methods.initialize(new BN(25), new BN(1)) // 25 USDC for 1 STAR
      .accounts(
      {
        pool: pool.publicKey,
        payer: provider.wallet.publicKey,
        authority: authority.publicKey,
        mintVault: mintVault.publicKey,
        mintSupply: mintSupply.publicKey,
      }
    )
      .signers([pool])
      .rpc();

    const endLamports = await provider.connection.getBalance(provider.wallet.publicKey);

    const costInLamports = startLamports - endLamports;
    console.log("Cost of creating a pool ", (costInLamports / web3.LAMPORTS_PER_SOL));

    expect(await supplyBalance(splProgram, pool.publicKey, program.programId)).to.be.equal(0);
    expect(await vaultBalance(splProgram, pool.publicKey, program.programId)).to.be.equal(0);
  });
});
