use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod simple_token_swap {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        price_numerator: u64,
        price_denominator: u64,
    ) -> Result<()> {
        require!(price_numerator > 0, MyError::InvalidPrice);
        require!(price_denominator > 0, MyError::InvalidPrice);

        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.enabled = false;
        pool.price_numerator = price_numerator;
        pool.price_denominator = price_denominator;

        pool.mint_vault = ctx.accounts.mint_vault.key();
        pool.mint_supply = ctx.accounts.mint_supply.key();

        pool.signer = ctx.accounts.signer.key();
        pool.signer_bump = *ctx
            .bumps
            .get("signer")
            .ok_or_else(|| error!(MyError::BumpSeedNotInHashMap))?;

        pool.vault = ctx.accounts.vault.key();
        pool.vault_bump = *ctx
            .bumps
            .get("vault")
            .ok_or_else(|| error!(MyError::BumpSeedNotInHashMap))?;

        pool.supply = ctx.accounts.supply.key();
        pool.supply_bump = *ctx
            .bumps
            .get("supply")
            .ok_or_else(|| error!(MyError::BumpSeedNotInHashMap))?;

        Ok(())
    }

    pub fn start_sale(ctx: Context<StartStopSale>) -> Result<()> {
        require!(!ctx.accounts.pool.enabled, MyError::AlreadyStarted);
        ctx.accounts.pool.enabled = true;
        Ok(())
    }

    pub fn stop_sale(ctx: Context<StartStopSale>) -> Result<()> {
        require!(ctx.accounts.pool.enabled, MyError::AlreadyStopped);
        ctx.accounts.pool.enabled = false;
        Ok(())
    }

    pub fn update_price(
        ctx: Context<UpdatePrice>,
        price_numerator: u64,
        price_denominator: u64,
    ) -> Result<()> {
        require!(
            !ctx.accounts.pool.enabled,
            MyError::HaveToBeStoppedForPriceChange
        );
        require!(price_numerator > 0, MyError::InvalidPrice);
        require!(price_denominator > 0, MyError::InvalidPrice);

        ctx.accounts.pool.price_numerator = price_numerator;
        ctx.accounts.pool.price_denominator = price_denominator;

        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, amount: u64) -> Result<()> {
        require!(ctx.accounts.pool.enabled, MyError::SaleNotStarted);
        require!(amount > 0, MyError::AmountHasToBeNonZero);

        let pool = &ctx.accounts.pool;

        let amount_to_vault = u64::try_from(
            amount as u128 * pool.price_numerator as u128 / pool.price_denominator as u128,
        )
        .map_err(|_| error!(MyError::CalcFailure))?;

        let key = ctx.accounts.pool.key();
        let seeds = [
            b"signer".as_ref(),
            key.as_ref(),
            &[pool.signer_bump],
        ];

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_source.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount_to_vault,
        )?;

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.supply.to_account_info(),
                    to: ctx.accounts.user_token_dest.to_account_info(),
                    authority: ctx.accounts.signer.to_account_info(),
                },
                &[&seeds],
            ),
            amount,
        )?;

        Ok(())
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let mint = ctx.accounts.destination.mint;
        require!(
            mint == pool.mint_vault || mint == pool.mint_supply,
            MyError::InvalidWithdrawDestination
        );

        let source = if mint == pool.mint_vault {
            &ctx.accounts.vault
        } else {
            &ctx.accounts.supply
        };

        let key = ctx.accounts.pool.key();
        let seeds = [b"signer".as_ref(), key.as_ref(), &[pool.signer_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: source.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.signer.to_account_info(),
                },
                &[&seeds],
            ),
            source.amount,
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        space = Pool::SPACE,
        payer = payer,
    )]
    pub pool: Box<Account<'info, Pool>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Only for key()
    pub authority: UncheckedAccount<'info>,

    #[account(
        seeds = [b"signer".as_ref(), pool.key().as_ref()],
        bump
    )]
    /// CHECK: Only for key() and bump calc
    pub signer: UncheckedAccount<'info>,

    pub mint_vault: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        seeds = [b"vault".as_ref(), pool.key().as_ref()],
        bump,
        token::mint = mint_vault,
        token::authority = signer,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,

    pub mint_supply: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        seeds = [b"supply".as_ref(), pool.key().as_ref()],
        bump,
        token::mint = mint_supply,
        token::authority = signer,
    )]
    pub supply: Box<Account<'info, TokenAccount>>,

    pub rent: Sysvar<'info, Rent>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartStopSale<'info> {
    #[account(mut, has_one = authority)]
    pub pool: Account<'info, Pool>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdatePrice<'info> {
    #[account(mut, has_one = authority)]
    pub pool: Account<'info, Pool>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(
        has_one = mint_supply,
        has_one = vault,
        has_one = supply
    )]
    pub pool: Account<'info, Pool>,

    #[account(
        seeds = [b"signer".as_ref(), pool.key().as_ref()],
        bump = pool.signer_bump
    )]
    /// CHECK: Only for key() and bump calc
    pub signer: UncheckedAccount<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_token_source: Account<'info, TokenAccount>,

    pub mint_supply: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = mint_supply,
        associated_token::authority = user,
    )]
    pub user_token_dest: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [b"supply".as_ref(), pool.key().as_ref()],
        bump = pool.supply_bump,
    )]
    pub supply: Account<'info, TokenAccount>,

    pub rent: Sysvar<'info, Rent>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(has_one = authority)]
    pub pool: Account<'info, Pool>,
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"signer".as_ref(), pool.key().as_ref()],
        bump = pool.signer_bump
    )]
    /// CHECK: Only for key() and bump calc
    pub signer: UncheckedAccount<'info>,

    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"vault".as_ref(), pool.key().as_ref()],
        bump = pool.vault_bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"supply".as_ref(), pool.key().as_ref()],
        bump = pool.supply_bump,
    )]
    pub supply: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub enabled: bool,

    // amount of 1 TOKEN SUPPLY for price_numerator / price_denominator TOKENS VAULT
    pub price_numerator: u64,
    pub price_denominator: u64,

    pub mint_vault: Pubkey,
    pub mint_supply: Pubkey,

    pub signer: Pubkey,
    pub signer_bump: u8,

    pub vault: Pubkey,
    pub vault_bump: u8,

    pub supply: Pubkey,
    pub supply_bump: u8,
}

impl Pool {
    pub const SPACE: usize = 8 + std::mem::size_of::<Pool>();
}

#[error_code]
pub enum MyError {
    BumpSeedNotInHashMap,
    InvalidPrice,
    AlreadyStarted,
    AlreadyStopped,
    HaveToBeStoppedForPriceChange,
    AmountHasToBeNonZero,
    CalcFailure,
    SaleNotStarted,
    InvalidWithdrawDestination,
}
