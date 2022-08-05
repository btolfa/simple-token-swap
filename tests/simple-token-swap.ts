import * as anchor from "@project-serum/anchor";
import { Program, web3, BN } from "@project-serum/anchor";
import { PublicKey, Keypair } from '@solana/web3.js';
import { SimpleTokenSwap } from "../target/types/simple_token_swap";

import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);

import * as fs from "fs";
import {
  createToken,
  creatMintIfRequired,
  getATA,
  mintTo,
  mintToATA,
  supplyBalance,
  tokenBalance,
  vaultBalance
} from "./utils";

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

    await createToken(splProgram, supplyFund, mintSupply.publicKey, provider.wallet.publicKey);
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

    let poolAcc = await program.account.pool.fetch(pool.publicKey);
    expect(poolAcc.enabled).to.be.false;
  });

  it("Should supply pool with tokens", async() => {
    const [supply, _nonce] = await PublicKey.findProgramAddress(
      [anchor.utils.bytes.utf8.encode("supply"), pool.publicKey.toBuffer()],
      program.programId
    );
    expect(await tokenBalance(splProgram, supply)).to.be.equal(0);

    // Send 1000 tokens
    await splProgram.methods.transfer(new BN(1000_000_000))
      .accounts({
        source: supplyFund.publicKey,
        destination: supply,
        authority: provider.wallet.publicKey,
      }).rpc();

    expect(await tokenBalance(splProgram, supply)).to.be.equal(1000_000_000);
  });

  it("Should start sale", async() => {
    // only authority can start or stop sale
    // todo: add tests for start/stop sale without proper authority
    await program.methods.startSale().accounts(
      {
        pool: pool.publicKey,
        authority: authority.publicKey,
      }
    ).signers([authority])
      .rpc();
    let poolAcc = await program.account.pool.fetch(pool.publicKey);
    expect(poolAcc.enabled).to.be.true;
  });

  it("Should buy 1 STAR token for 25 USDC", async() => {
    await mintToATA(splProgram, provider.wallet.publicKey, new BN(26_000_000), mintVault.publicKey, provider.wallet.publicKey);
    expect(await tokenBalance(splProgram, await getATA(provider.wallet.publicKey, mintVault.publicKey))).to.be.equal(26_000_000);

    const suppyBalanceBefore = await supplyBalance(splProgram, pool.publicKey, program.programId);
    const vaultBalanceBefore = await vaultBalance(splProgram, pool.publicKey, program.programId);

    await program.methods.buy(new BN(1_000_000))
      .accounts({
        pool: pool.publicKey,
        user: provider.wallet.publicKey,
        userTokenSource: await getATA(provider.wallet.publicKey, mintVault.publicKey),
        userTokenDest: await getATA(provider.wallet.publicKey, mintSupply.publicKey),
        mintSupply: mintSupply.publicKey,
      }).rpc();

    const suppyBalanceAfter = await supplyBalance(splProgram, pool.publicKey, program.programId);
    const vaultBalanceAfter = await vaultBalance(splProgram, pool.publicKey, program.programId);

    expect(await tokenBalance(splProgram, await getATA(provider.wallet.publicKey, mintVault.publicKey))).to.be.equal(1_000_000);
    expect(await tokenBalance(splProgram, await getATA(provider.wallet.publicKey, mintSupply.publicKey))).to.be.equal(1_000_000);
    expect(suppyBalanceAfter - suppyBalanceBefore).to.be.equal(-1_000_000);
    expect( vaultBalanceAfter - vaultBalanceBefore).to.be.equal(25_000_000);
  });

  it("Should withdraw vault tokens from pool", async() => {
    const vaultBalanceBefore = await vaultBalance(splProgram, pool.publicKey, program.programId);
    const ataBalanceBefore = await tokenBalance(splProgram, await getATA(provider.wallet.publicKey, mintVault.publicKey));

    // only authority can withdraw tokens
    await program.methods.withdraw()
      .accounts(
        {
          pool: pool.publicKey,
          authority: authority.publicKey,
          destination: await getATA(provider.wallet.publicKey, mintVault.publicKey),
        }
      ).signers([authority])
      .rpc();

    const ataBalanceAfter = await tokenBalance(splProgram, await getATA(provider.wallet.publicKey, mintVault.publicKey));
    expect(await vaultBalance(splProgram, pool.publicKey, program.programId)).to.be.equal(0);
    expect(ataBalanceAfter - ataBalanceBefore).to.be.equal(vaultBalanceBefore);
  });

  it("Should update price to 26 USDC to 1 STAR", async() => {
    let poolAcc = await program.account.pool.fetch(pool.publicKey);
    expect(poolAcc.priceNumerator.toNumber()).to.be.equal(25);
    expect(poolAcc.priceDenominator.toNumber()).to.be.equal(1);

    // sale should be stopped for price update

    await program.methods.updatePrice(new BN(26), new BN(1))
      .accounts({
        pool: pool.publicKey,
        authority: authority.publicKey,
      })
      .preInstructions(
        [
          // the sale has to be stopped before price update
          await program.methods.stopSale()
            .accounts({
              pool: pool.publicKey,
              authority: authority.publicKey,
            }).instruction()
        ]
      )
      .postInstructions(
        [
          await program.methods.startSale()
            .accounts({
              pool: pool.publicKey,
              authority: authority.publicKey,
            }).instruction()
        ]
      )
      .signers([authority]).rpc();

    poolAcc = await program.account.pool.fetch(pool.publicKey);
    expect(poolAcc.priceNumerator.toNumber()).to.be.equal(26);
    expect(poolAcc.priceDenominator.toNumber()).to.be.equal(1);
  });
});
