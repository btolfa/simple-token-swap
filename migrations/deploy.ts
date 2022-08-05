// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import {Keypair, PublicKey} from "@solana/web3.js";

const anchor = require("@project-serum/anchor");

import {BN, Program} from "@project-serum/anchor";
import { SimpleTokenSwap } from "../target/types/simple_token_swap";

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);
  const program = anchor.workspace.Staking as Program<SimpleTokenSwap>;

  const endpoint = provider.connection.rpcEndpoint;
  if (endpoint.includes("localhost") || endpoint.includes("devnet")) {
    await initDevnet(program);
  } else {
    await initMainnet(program);
  }
};

async function initDevnet(program: Program<SimpleTokenSwap>) {
  // tests/keys/authority.json
  const authority = new PublicKey("HdbEinYYddfPJNXK2EQ2pfEsy3jyfdXjt1EGwsLRvYV1");

  // tests/keys/mint_supply.json
  const mint_suppty = new PublicKey("Bn7EFJXkK5uouriedPTVrLBJsTxLQ6DwTZf7iWxgH8d6")

  // tests/keys/mint_vault.json
  const mint_vault = new PublicKey("CQvrBGkz969f23jxXXKxMP2HKt3q9pD7fdmNKFvmfTE8")

  await initPool(program, authority, mint_suppty, mint_vault);
}

async function initMainnet(program: Program<SimpleTokenSwap>) {
  // TODO: Set correct authority
  const authority = new PublicKey("HdbEinYYddfPJNXK2EQ2pfEsy3jyfdXjt1EGwsLRvYV1");

  // TODO: Set correct supply
  const mint_suppty = new PublicKey("Bn7EFJXkK5uouriedPTVrLBJsTxLQ6DwTZf7iWxgH8d6")

  // USDC
  const mint_vault = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

  await initPool(program, authority, mint_suppty, mint_vault);
}

async function initPool(program: Program<SimpleTokenSwap>, authority: PublicKey, mintSupply: PublicKey, mintVault: PublicKey) {
  const pool = Keypair.generate();

  const provider = anchor.getProvider();

  const keys = await program.methods.initialize(new BN(25), new BN(1))
    .accounts(
      {
        pool: pool.publicKey,
        payer: provider.wallet.publicKey,
        authority,
        mintVault,
        mintSupply,
      }
    ).pubkeys();

  await program.methods.initialize(new BN(25), new BN(1))
    .accounts(
      {
        pool: pool.publicKey,
        payer: provider.wallet.publicKey,
        authority,
        mintVault,
        mintSupply,
      }
    )
    .signers([pool])
    .rpc();

  console.log("Program: ", program.programId.toString());
  console.log("Pool: ", pool.publicKey.toString());
  console.log("Authority: ", authority.toString());
  console.log("Mint Vault (USDC): ", mintVault.toString());
  console.log("Mint Supply: ", mintSupply.toString());
  console.log("Vault: ", keys['vault'].toString())
  console.log("Supply: ", keys['supply'].toString())
}