import {
  ERC20MintableInstance,
  MockCompoundOracleInstance,
  OptionsContractInstance,
  OptionsExchangeInstance,
  OptionsFactoryInstance
} from '../build/types/truffle-types';

const BigNumber = require('bignumber.js');

const OptionsContract = artifacts.require('OptionsContract');
const OptionsFactory = artifacts.require('OptionsFactory');
const OptionsExchange = artifacts.require('OptionsExchange');
const MockCompoundOracle = artifacts.require('MockCompoundOracle');
const MockUniswapFactory = artifacts.require('MockUniswapFactory');
const MintableToken = artifacts.require('ERC20Mintable');

const {
  BN,
  constants,
  balance,
  time,
  expectEvent,
  expectRevert,
  ether
} = require('@openzeppelin/test-helpers');

function calculateMaxOptionsToCreate(
  collateral: number,
  collateralToStrikePrice: number,
  minminCollateralizationRatio: number,
  strikePrice: number
): number {
  return Math.floor(
    (collateral * collateralToStrikePrice) /
      (minminCollateralizationRatio * strikePrice)
  );
}

contract(
  'ETH Call Option',
  ([
    opynDeployer,
    vaultOwner1,
    vaultOwner2,
    vaultOwner3,
    buyer1,
    buyer2,
    random
  ]) => {
    let optionContract: OptionsContractInstance;
    let optionsFactory: OptionsFactoryInstance;
    let optionsExchange: OptionsExchangeInstance;
    let compoundOracle: MockCompoundOracleInstance;
    let usdc: ERC20MintableInstance;

    const _name = 'test call option $200';
    const _symbol = 'test oETH $200';
    const _collateralType = 'ETH';
    const _collateralExp = -18;
    const _underlyingType = 'USDC';
    const _underlyingExp = -6;
    const _oTokenExchangeExp = -6;
    const _strikePrice = 5;
    const _strikeExp = -9;
    const _strikeAsset = 'ETH';
    const _expiry = Math.round(new Date().getTime() / 1000) + 3600 * 24 * 7;
    const _windowSize = Math.round(new Date().getTime() / 1000) + 3600 * 24 * 7;
    const _liquidationIncentiveValue = 0;
    const _liquidationIncentiveExp = -3;
    const _liquidationFactorValue = 0;
    const _liquidationFactorExp = -3;
    const _transactionFeeValue = 0;
    const _transactionFeeExp = -3;
    const _minCollateralizationRatioValue = 10;
    const _minCollateralizationRatioExp = -1;

    const mintedAmount = ether('500');
    const ethCollateralToAdd = ether('10');

    before('set up contracts', async () => {
      // deploy compound oracle mock
      compoundOracle = await MockCompoundOracle.deployed();

      // usdc token
      usdc = await MintableToken.new();

      // get deployed opyn protocol contracts

      // Options Exhange contract
      optionsExchange = await OptionsExchange.deployed();

      // Options Factory contract and add assets to it
      optionsFactory = await OptionsFactory.deployed();

      // add assets to the factory
      await optionsFactory.addAsset('USDC', usdc.address, {from: opynDeployer});

      // create ETH call option
      const optionsContractResult = await optionsFactory.createOptionsContract(
        _collateralType,
        _collateralExp,
        _underlyingType,
        _underlyingExp,
        _oTokenExchangeExp,
        _strikePrice,
        _strikeExp,
        _strikeAsset,
        _expiry,
        _windowSize,
        {from: opynDeployer}
      );

      optionContract = await OptionsContract.at(
        optionsContractResult.logs[1].args[0]
      );

      // set option details
      await optionContract.setDetails(_name, _symbol, {from: opynDeployer});

      // set option params
      await optionContract.updateParameters(
        _liquidationIncentiveValue,
        _liquidationFactorValue,
        _transactionFeeValue,
        _minCollateralizationRatioValue,
        {from: opynDeployer}
      );

      // mint money for everyone
      await usdc.mint(opynDeployer, mintedAmount);
      await usdc.mint(vaultOwner1, mintedAmount);
      await usdc.mint(vaultOwner2, mintedAmount);
      await usdc.mint(vaultOwner3, mintedAmount);
      await usdc.mint(buyer1, mintedAmount);
      await usdc.mint(buyer2, mintedAmount);
    });

    describe('Check deployment', () => {
      it('check deployment config', async () => {
        assert.equal(await optionContract.name(), _name, 'invalid name');
        assert.equal(await optionContract.symbol(), _symbol, 'invalid symbol');
        assert.equal(
          await optionContract.collateral(),
          await optionsFactory.tokens(_collateralType),
          'invalid collateral'
        );
        assert.equal(
          (await optionContract.collateralExp()).toString(),
          String(_collateralExp),
          'invalid collateral exponent'
        );
        assert.equal(
          await optionContract.underlying(),
          await optionsFactory.tokens(_underlyingType),
          'invalid underlying'
        );
        assert.equal(
          (await optionContract.underlyingExp()).toString(),
          String(_underlyingExp),
          'invalid underlying exponent'
        );
        assert.equal(
          (await optionContract.oTokenExchangeRate())[1].toString(),
          String(_oTokenExchangeExp),
          'invalid oToken exchange rate'
        );
        assert.equal(
          (await optionContract.strikePrice())[0].toString(),
          String(_strikePrice),
          'invalid strike price'
        );
        assert.equal(
          (await optionContract.strikePrice())[1].toString(),
          String(_strikeExp),
          'invalid strike exponent'
        );
        assert.equal(
          await optionContract.strike(),
          await optionsFactory.tokens(_strikeAsset),
          'invalid strike asset'
        );
        assert.equal(
          await (await optionContract.expiry()).toString(),
          String(_expiry),
          'invalid expiry'
        );
      });
    });

    describe('Open vault', () => {
      it('open vault', async () => {
        // owner 1
        await optionContract.openVault({
          from: vaultOwner1
        });

        // owner 2
        await optionContract.openVault({
          from: vaultOwner2
        });

        // owner 3
        await optionContract.openVault({
          from: vaultOwner3
        });

        assert.equal(
          await optionContract.hasVault(vaultOwner1),
          true,
          'error creating vault for owner1'
        );
        assert.equal(
          await optionContract.hasVault(vaultOwner2),
          true,
          'error creating vault for owner2'
        );
        assert.equal(
          await optionContract.hasVault(vaultOwner3),
          true,
          'error creating vault for owner3'
        );
      });

      it('should revert openning a vault for an already vault owner', async () => {
        await expectRevert(
          optionContract.openVault({
            from: vaultOwner1
          }),
          'Vault already created'
        );

        await expectRevert(
          optionContract.openVault({
            from: vaultOwner2
          }),
          'Vault already created'
        );

        await expectRevert(
          optionContract.openVault({
            from: vaultOwner2
          }),
          'Vault already created'
        );
      });
    });

    describe('Add colateral', () => {
      it('should revert adding collateral to a non existing vault', async () => {
        await expectRevert(
          optionContract.addETHCollateral(random, {
            from: random,
            value: ethCollateralToAdd
          }),
          'Vault does not exist'
        );
      });

      it('add collateral to vault', async () => {
        const vault1CollateralBefore = (
          await optionContract.getVault(vaultOwner1)
        )[0].toString();
        const vault2CollateralBefore = (
          await optionContract.getVault(vaultOwner2)
        )[0].toString();
        const vault3CollateralBefore = (
          await optionContract.getVault(vaultOwner3)
        )[0].toString();

        await optionContract.addETHCollateral(vaultOwner1, {
          from: vaultOwner1,
          value: ethCollateralToAdd
        });
        await optionContract.addETHCollateral(vaultOwner2, {
          from: vaultOwner2,
          value: ethCollateralToAdd
        });
        await optionContract.addETHCollateral(vaultOwner3, {
          from: vaultOwner3,
          value: ethCollateralToAdd
        });

        const vault1CollateralAfter = (
          await optionContract.getVault(vaultOwner1)
        )[0].toString();
        const vault2CollateralAfter = (
          await optionContract.getVault(vaultOwner2)
        )[0].toString();
        const vault3CollateralAfter = (
          await optionContract.getVault(vaultOwner3)
        )[0].toString();

        assert.equal(
          new BigNumber(vault1CollateralAfter)
            .minus(new BigNumber(vault1CollateralBefore))
            .toString(),
          ethCollateralToAdd.toString(),
          'error deposited ETH collateral'
        );
        assert.equal(
          new BigNumber(vault2CollateralAfter)
            .minus(new BigNumber(vault2CollateralBefore))
            .toString(),
          ethCollateralToAdd.toString(),
          'error deposited ETH collateral'
        );
        assert.equal(
          new BigNumber(vault3CollateralAfter)
            .minus(new BigNumber(vault3CollateralBefore))
            .toString(),
          ethCollateralToAdd.toString(),
          'error deposited ETH collateral'
        );
      });

      it('should revert adding ERC20 token as collateral', async () => {
        await expectRevert(
          optionContract.addERC20Collateral(vaultOwner1, '10', {
            from: vaultOwner1,
            value: ethCollateralToAdd
          }),
          'revert'
        );
      });
    });

    describe('Issue oToken', () => {
      it('check max oToken each vault can sell', async () => {
        const vaultsCollateral = [];

        vaultsCollateral.push(
          (await optionContract.getVault(vaultOwner1))[0].toString()
        );
        vaultsCollateral.push(
          (await optionContract.getVault(vaultOwner2))[0].toString()
        );
        vaultsCollateral.push(
          (await optionContract.getVault(vaultOwner3))[0].toString()
        );

        for (let i = 0; i <= vaultsCollateral.length; i++) {
          const _maxIssuable =
            calculateMaxOptionsToCreate(
              Number(vaultsCollateral[0]) / 10 ** 12,
              1,
              _minCollateralizationRatioValue *
                10 ** _minCollateralizationRatioExp,
              _strikePrice * 10 ** _strikeExp
            ) /
            10 ** 6;
          assert.equal(
            (
              await optionContract.maxOTokensIssuable(vaultsCollateral[0])
            ).toString(),
            String(_maxIssuable),
            'max otoken issuable mismatch'
          );
        }
      });

      it('should revert issuing oToken more than maximum', async () => {
        const vaultCollateral = (
          await optionContract.getVault(vaultOwner1)
        )[0].toString();
        const _maxIssuable = (
          await optionContract.maxOTokensIssuable(vaultCollateral)
        ).toString();

        await expectRevert(
          optionContract.issueOTokens('5000', vaultOwner1, {
            from: vaultOwner1,
            value: ethCollateralToAdd
          }),
          'revert'
        );
      });

      it('issue oToken', async () => {
        const _amountToIssue = '2000';

        await optionContract.issueOTokens(_amountToIssue, vaultOwner1, {
          from: vaultOwner1
        });
        await optionContract.issueOTokens(_amountToIssue, vaultOwner2, {
          from: vaultOwner2
        });
        await optionContract.issueOTokens(_amountToIssue, vaultOwner3, {
          from: vaultOwner3
        });

        const vault1After = await optionContract.getVault(vaultOwner1);
        const vault2After = await optionContract.getVault(vaultOwner2);
        const vault3After = await optionContract.getVault(vaultOwner3);

        const vaultOwner1BalanceAfter = await optionContract.balanceOf(
          vaultOwner1
        );
        const vaultOwner2BalanceAfter = await optionContract.balanceOf(
          vaultOwner2
        );
        const vaultOwner3BalanceAfter = await optionContract.balanceOf(
          vaultOwner3
        );

        assert.equal(
          vault1After[1].toString(),
          vaultOwner1BalanceAfter.toString(),
          'invalid issued amount'
        );
        assert.equal(
          vault2After[1].toString(),
          vaultOwner2BalanceAfter.toString(),
          'invalid issued amount'
        );
        assert.equal(
          vault3After[1].toString(),
          vaultOwner3BalanceAfter.toString(),
          'invalid issued amount'
        );
      });
    });

    describe('Exercice', () => {});
  }
);