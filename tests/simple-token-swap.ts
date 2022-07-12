import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { SimpleTokenSwap } from "../target/types/simple_token_swap";

describe("simple-token-swap", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.SimpleTokenSwap as Program<SimpleTokenSwap>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.methods.initialize().rpc();
    console.log("Your transaction signature", tx);
  });
});
