/* eslint no-console:0, max-len:0, no-plusplus:0, no-mixed-operators:0, no-trailing-spaces:0 */

const PriceOracleInterface = artifacts.require('PriceOracleInterface')

const { 
  eventWatcher,
  logger,
  timestamp,
  assertRejects,
} = require('./utils')

const {
  setupTest,
  getContracts,
  getAuctionIndex,
  checkBalanceBeforeClaim,
  waitUntilPriceIsXPercentOfPreviousPrice,
  setAndCheckAuctionStarted,
} = require('./testFunctions')

// Test VARS
let eth
let gno
let dx
let oracle
let tokenTUL


let contracts

const setupContracts = async () => {
  contracts = await getContracts();
  // destructure contracts into upper state
  ({
    DutchExchange: dx,
    EtherToken: eth,
    TokenGNO: gno,
    TokenTUL: tokenTUL,
    PriceOracle: oracle,
  } = contracts)
}

contract('DutchExchange', (accounts) => {
  const [, seller1, , buyer1] = accounts

  beforeEach(async () => {
    // get contracts
    await setupContracts()

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 9,
      0,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('Buys tokens at the 2:1 price', async () => {
    eventWatcher(dx, 'NewTokenPair', {})
    
    const auctionIndex = await getAuctionIndex()

    logger('curr AuctionIndex', auctionIndex)
    
    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)
    
    logger('setAndCheckAuctionStarted')
    
    // oracle = await PriceOracle.deployed()
    
    logger('PRICE ORACLE', await PriceOracleInterface.at(oracle.address).getUSDETHPrice.call())    
    // wait until price is good
    logger('ETH Addr', eth.address)
    logger('dx.ETH', await dx.ETH.call())
    logger('dx.testing GNO price num', await dx.testing.call(gno.address))
    logger('dx.testing ETH price num', await dx.testing.call(eth.address))
    logger('dx.testing2 ETH/GNO', await dx.testing2.call(eth.address, gno.address, auctionIndex))
    logger('dx.testing2 GNO/ETH', await dx.testing2.call(gno.address, eth.address, auctionIndex))
    
    // console.log("this was price oracle")
    // console.log((await dx.getPrice.call(eth.address, gno.address, auctionIndex)))
    
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1)
    
    logger('Waited until price is there')    
    
    // buy
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9 * 2, { from: buyer1 })
    
    logger('postBuyOrder went through')
    logger('Current AuctionIdx', await getAuctionIndex())
    logger('dx.getPrice.num eth gno', await dx.testing2.call(eth.address, gno.address, auctionIndex))
    logger('dx.getPrice.num gno/eth', await dx.testing2.call(gno.address, eth.address, auctionIndex))
    logger('dx.oralcePrice.num gno/eth ', await dx.testing.call(gno.address))
    logger('dx.oralcePrice.num gno/eth ', await dx.testing.call(eth.address))
    /* -- claim Buyerfunds - function does this:
    * 1. balanceBeforeClaim = (await dx.balances.call(eth.address, buyer1)).toNumber()
    * 2. await dx.claimBuyerFunds(eth.address, gno.address, buyer1, auctionIndex)
    * 3. assert.equal(balanceBeforeClaim + 10 ** 9 - (await dx.balances.call(eth.address, buyer1)).toNumber() < MaxRoundingError, true)
    */
    await checkBalanceBeforeClaim(buyer1, auctionIndex, 'buyer', eth, gno, (10 ** 9 - 10 ** 9 / 200))

    // claim Sellerfunds
    await checkBalanceBeforeClaim(seller1, auctionIndex, 'seller', eth, gno, (10 ** 9 * 2 - 10 ** 9 / 100 * 2 / 2))
  })
})


contract('DutchExchange', (accounts) => {
  const [, seller1, seller2, buyer1, buyer2] = accounts

  beforeEach(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 9,
      0,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('process two auctions one after the other in one pair only', async () => {
    let auctionIndex

    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)

    auctionIndex = await getAuctionIndex()
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1)
    
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9 * 2, { from: buyer1 })

    // check Buyer1 balance and claim
    await checkBalanceBeforeClaim(buyer1, auctionIndex, 'buyer', eth, gno, (10 ** 9 - 10 ** 9 / 200))
    // check Seller1 Balance
    await checkBalanceBeforeClaim(seller1, auctionIndex, 'seller', eth, gno, (10 ** 9 * 2 - 10 ** 9 / 100 * 2 / 2))

    // post new sell order to start next auction
    auctionIndex = await getAuctionIndex()
    logger('new auction index:', auctionIndex)
    logger('auctionStartDate', (await dx.getAuctionStart(eth.address, gno.address)).toNumber())
    logger('current time', timestamp())
    logger('tuliptoken', await tokenTUL.totalTokens())
    await dx.postSellOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: seller2 })
    logger('sell order went through')
    logger('setandCheck returns:', await setAndCheckAuctionStarted(eth, gno))

    auctionIndex = await getAuctionIndex()
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9 * 2, { from: buyer2 })
  })
})

contract('DutchExchange', (accounts) => {
  const [, seller1, seller2, buyer1, buyer2] = accounts

  beforeEach(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 9,
      10 ** 8 * 5,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('test a trade on the opposite pair', async () => {
    let auctionIndex

    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)
    auctionIndex = await getAuctionIndex()
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1)
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9 * 2, { from: buyer1 })
    console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    console.log('this one isnt working right?')
    console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
    await dx.postBuyOrder(gno.address, eth.address, auctionIndex, 10 ** 7 * 25, { from: seller2 })
    logger('startingReclaiming')
    logger('dx.getPrice.num eth gno', await dx.testing2.call(eth.address, gno.address, auctionIndex))
    logger('dx.getPrice.num gno/eth', await dx.testing2.call(gno.address, eth.address, auctionIndex))
    logger('dx.oralcePrice.num gno/eth ', await dx.testing.call(gno.address))
    logger('dx.oralcePrice.num gno/eth ', await dx.testing.call(eth.address))
    // claim buyer1 BUYER funds
    await checkBalanceBeforeClaim(buyer1, auctionIndex, 'buyer', eth, gno, (10 ** 9 - 10 ** 9 / 200))
    // claim seller2 BUYER funds - RECIPROCAL
    await checkBalanceBeforeClaim(seller2, auctionIndex, 'buyer', gno, eth, (10 ** 8 * 5 - 10 ** 8 * 5 / 200))
    // claim SELLER funds
    await checkBalanceBeforeClaim(seller1, auctionIndex, 'seller', eth, gno, (10 ** 9 * 2 - 10 ** 9 * 2 / 200))

    // post new sell order to start next auction
    // startingTimeOfAuction = await getStartingTimeOfAuction(eth, gno)
    auctionIndex = await getAuctionIndex()
    logger('new auction index:', auctionIndex)
    logger('auctionStartDate', (await dx.getAuctionStart(eth.address, gno.address)).toNumber())

    await dx.postSellOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: seller2 })

    // check Auction has started
    await setAndCheckAuctionStarted(eth, gno)

    auctionIndex = await getAuctionIndex()
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9 * 2, { from: buyer2 })
  })
})

contract('DutchExchange', (accounts) => {
  const [, seller1, , buyer1] = accounts

  beforeEach(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 9,
      0,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('clearing an auction with buyOrder, after it closed theoretical', async () => {
    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)

    const auctionIndex = await getAuctionIndex()
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.99)
    
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: buyer1 })


    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.4)
    const previousBuyVolume = (await dx.buyVolumes(eth.address, gno.address)).toNumber()
    logger('previousBuyVolume', previousBuyVolume)
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: buyer1 })
    const [closingPriceNum] = await dx.closingPrices.call(eth.address, gno.address, auctionIndex)
    assert.equal(previousBuyVolume, closingPriceNum)

    // check Buyer1 balance and claim
    await checkBalanceBeforeClaim(buyer1, auctionIndex, 'buyer', eth, gno, (10 ** 9 - 10 ** 9 / 200))
    // check Seller1 Balance
    await checkBalanceBeforeClaim(seller1, auctionIndex, 'seller', eth, gno, (10 ** 9 - 10 ** 9 / 200))
  })
})

contract('DutchExchange', (accounts) => {
  const [, seller1, , buyer1] = accounts

  beforeEach(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 9,
      0,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('clearing an auction + opposite Auction with buyOrder, after it closed theoretical', async () => {
    let auctionIndex

    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)

    auctionIndex = await getAuctionIndex()
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1.01)
    
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: buyer1 })


    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.4)
    const previousBuyVolume = (await dx.buyVolumes(eth.address, gno.address)).toNumber()
    logger('previousBuyVolume', previousBuyVolume)
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 9, { from: buyer1 })
    const [closingPriceNum] = await dx.closingPrices.call(eth.address, gno.address, auctionIndex)
    assert.equal(previousBuyVolume, closingPriceNum)
    auctionIndex = await getAuctionIndex()
    assert.equal(auctionIndex, 2, 'one auction is still pending and was not closed')
    // check Buyer1 balance and claim
    await checkBalanceBeforeClaim(buyer1, 1, 'buyer', eth, gno, (10 ** 9 - 10 ** 9 / 200))
    // check Seller1 Balance
    await checkBalanceBeforeClaim(seller1, 1, 'seller', eth, gno, (10 ** 9 - 10 ** 9 / 200))
  })
})
contract('DutchExchange', (accounts) => {
  const [, seller1, , buyer1] = accounts

  beforeEach(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts)

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10 ** 8,
      0,
      2,
      1,
      { from: seller1 },
    )
  })

  after(eventWatcher.stopWatching)

  it('clearing an 0 sellVolume opposite auction after 6 hours and check shift of NextSellVolume', async () => {
    // ASSERT Auction has started
    await setAndCheckAuctionStarted(eth, gno)

    const auctionIndex = await getAuctionIndex()
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.99)
    
    await dx.postSellOrder(eth.address, gno.address, auctionIndex + 1, 10 ** 8, { from: seller1 })
    let nextSellVolume = (await dx.sellVolumesNext.call(eth.address, gno.address)).toNumber()
    assert.equal(nextSellVolume, 10 ** 8 - 10 ** 8 / 200)
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 8, { from: buyer1 })

    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.4)
    const currentSellVolume = (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber()
    assert.equal(currentSellVolume, 10 ** 8 - 10 ** 8 / 200)
    logger('current SellVolume', currentSellVolume)

    nextSellVolume = (await dx.sellVolumesNext.call(eth.address, gno.address)).toNumber()
    assert.equal(nextSellVolume, 10 ** 8 - 10 ** 8 / 200, 'sellVolumeNextNotCorrectAfterClearing')
    logger('nextSellVolume', nextSellVolume)
    console.log(nextSellVolume)
    await dx.postBuyOrder(eth.address, gno.address, auctionIndex, 10 ** 8, { from: buyer1 })
    assert.equal(nextSellVolume, (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber())
    assert.equal((await dx.sellVolumesNext.call(eth.address, gno.address)).toNumber(), 0, 'sellVOlumeNext is not reseted')

    // check Buyer1 balance and claim
    await checkBalanceBeforeClaim(buyer1, auctionIndex, 'buyer', eth, gno, (10 ** 8 - 10 ** 8 / 200))
    // check Seller1 Balance
    await checkBalanceBeforeClaim(seller1, auctionIndex, 'seller', eth, gno, (10 ** 8 - 10 ** 8 / 200))
  })
})

contract('DutchExchange deposit/withdraw tests', (accounts) => {
  const [master] = accounts
  const testingAccs = accounts.slice(1, 5)

  const ETHBalance = 10 ** 9
  
  const GNOBalance = 10 ** 15

  before(async () => {
    // get contracts
    contracts = await getContracts();
    // destructure contracts into upper state
    ({
      DutchExchange: dx,
      EtherToken: eth,
      TokenGNO: gno,
      TokenTUL: tokenTUL,
      PriceOracle: oracle,
    } = contracts)

    // set up initial balances for accounts and allowance for dx in accounts' names
    await Promise.all(testingAccs.map(acct => Promise.all([
      eth.deposit({ from: acct, value: ETHBalance }),
      eth.approve(dx.address, ETHBalance, { from: acct }),
      gno.transfer(acct, GNOBalance, { from: master }),
      gno.approve(dx.address, GNOBalance, { from: acct }),
    ])))
    eventWatcher(dx, 'NewDeposit')
    eventWatcher(dx, 'NewWithdrawal')
  })

  after(eventWatcher.stopWatching)

  const getAccDeposits = async (acc) => {
    const [ETH, GNO] = (await Promise.all([
      dx.balances(eth.address, acc),
      dx.balances(gno.address, acc),
    ])).map(n => n.toNumber())

    return { ETH, GNO }
  }

  const getAccBalances = async (acc) => {
    const [ETH, GNO] = (await Promise.all([
      eth.balanceOf(acc),
      gno.balanceOf(acc),
    ])).map(n => n.toNumber())

    return { ETH, GNO }
  }

  const getAccAllowance = async (owner, spender) => {
    const [ETH, GNO] = (await Promise.all([
      eth.allowance(owner, spender),
      gno.allowance(owner, spender),
    ])).map(n => n.toNumber())

    return { ETH, GNO }
  }

  it('intially deposits are 0', () => Promise.all(testingAccs.map(async (acc) => {
    const { ETH, GNO } = await getAccDeposits(acc)

    assert.strictEqual(ETH, 0, `${acc} ETH deposit should be 0`)
    assert.strictEqual(GNO, 0, `${acc} GNO deposit should be 0`)
  })))

  it('can deposit the right amount ', () => Promise.all(testingAccs.map(async (acc) => {
    const depositETH = 100
    const depositGNO = 200

    // make sure we don't deposit more than available
    assert.isBelow(depositETH, ETHBalance, 'trying to deposit more ETH than available')
    assert.isBelow(depositGNO, GNOBalance, 'trying to deposit more GNO than available')

    logger(`${acc} depositing\t${depositETH} ETH,\t${depositGNO} GNO`)

    await dx.deposit(eth.address, depositETH, { from: acc })
    await dx.deposit(gno.address, depositGNO, { from: acc })

    const { ETH: ETHDep, GNO: GNODep } = await getAccDeposits(acc)

    logger(`${acc} deposits:\t${ETHDep} ETH,\t${GNODep} GNO`)
    // all deposits got accepted
    assert.strictEqual(ETHDep, depositETH, 'new ETH balance in auction should be equal to deposited amount')
    assert.strictEqual(GNODep, depositGNO, 'new GNO balance in auction should be equal to deposited amount')

    const { ETH: ETHBal, GNO: GNOBal } = await getAccBalances(acc)
    // deposit amounts got correctly subtracted from account balances
    assert.strictEqual(ETHDep, ETHBalance - ETHBal, `${acc}'s ETH balance should decrease by the amount deposited`)
    assert.strictEqual(GNODep, GNOBalance - GNOBal, `${acc}'s GNO balance should decrease by the amount deposited`)
  })))

  it('can withdraw the right amount ', () => Promise.all(testingAccs.map(async (acc) => {
    const withdrawETH = 90
    const withdrawGNO = 150

    const { ETH, GNO } = await getAccDeposits(acc)

    // make sure we don't withdraw more than available
    assert.isBelow(withdrawETH, ETH, 'trying to withdraw more ETH than available')
    assert.isBelow(withdrawGNO, GNO, 'trying to withdraw more GNO than available')

    const { ETH: ETHDep1, GNO: GNODep1 } = await getAccDeposits(acc)
    const { ETH: ETHBal1, GNO: GNOBal1 } = await getAccBalances(acc)

    logger(`${acc} withdrawing\t${withdrawETH} ETH,\t${withdrawGNO} GNO`)

    await dx.withdraw(eth.address, withdrawETH, { from: acc })
    await dx.withdraw(gno.address, withdrawGNO, { from: acc })

    const { ETH: ETHDep2, GNO: GNODep2 } = await getAccDeposits(acc)
    const { ETH: ETHBal2, GNO: GNOBal2 } = await getAccBalances(acc)

    logger(`${acc} deposits:\t${ETHDep2} ETH,\t${GNODep2} GNO`)
    assert.strictEqual(ETHDep1 - ETHDep2, withdrawETH, 'ETH deposit should decrease by the amount withdrawn')
    assert.strictEqual(GNODep1 - GNODep2, withdrawGNO, 'GNO deposit should decrease by the amount withdrawn')

    assert.strictEqual(ETHBal2 - ETHBal1, withdrawETH, 'ETH balance should increase by the amount withdrawn')
    assert.strictEqual(GNOBal2 - GNOBal1, withdrawGNO, 'GNO balance should increase by the amount withdrawn')
  })))

  it('withdraws the whole deposit when trying to withdraw more than available', () => Promise.all(testingAccs.map(async (acc) => {
    const withdrawETH = 290
    const withdrawGNO = 350

    const { ETH: ETHDep1, GNO: GNODep1 } = await getAccDeposits(acc)

    // make sure we try to withdraw more than available
    assert.isAbove(withdrawETH, ETHDep1, 'should try to withdraw more ETH than available')
    assert.isAbove(withdrawGNO, GNODep1, 'should try to withdraw more GNO than available')

    const { ETH: ETHBal1, GNO: GNOBal1 } = await getAccBalances(acc)

    logger(`${acc} trying to withdraw\t${withdrawETH} ETH,\t${withdrawGNO} GNO`)

    // DutchExchange::withdraw Math.min resulted in balances[tokenAddress][msg.sender]
    await dx.withdraw(eth.address, withdrawETH, { from: acc })
    await dx.withdraw(gno.address, withdrawGNO, { from: acc })
    // assert.throws(() => dx.withdraw(eth.address, withdrawETH, { from: acc }))

    const { ETH: ETHDep2, GNO: GNODep2 } = await getAccDeposits(acc)
    const { ETH: ETHBal2, GNO: GNOBal2 } = await getAccBalances(acc)

    logger(`${acc} deposits:\t${ETHDep2} ETH,\t${GNODep2} GNO`)
    // all deposits were withdrawn
    assert.strictEqual(ETHDep2, 0, 'ETH deposit should be 0')
    assert.strictEqual(GNODep2, 0, 'GNO deposit should be 0')

    // balance increased by the actual amount withdrawn, not how uch we tried to withdraw
    assert.strictEqual(ETHBal2 - ETHBal1, ETHDep1, 'ETH balance should increase by the amount withdrawn (whole deposit)')
    assert.strictEqual(GNOBal2 - GNOBal1, GNODep1, 'GNO balance should increase by the amount withdrawn (whole deposit)')
  })))

  it('rejects when trying to wihdraw when deposit is 0', () => Promise.all(testingAccs.map(async (acc) => {
    const withdrawETH = 10
    const withdrawGNO = 20

    const { ETH: ETHDep1, GNO: GNODep1 } = await getAccDeposits(acc)

    // make sure we try to withdraw more than available
    assert.strictEqual(ETHDep1, 0, 'ETH deposit should be 0')
    assert.strictEqual(GNODep1, 0, 'GNO deposit should be 0')

    logger(`${acc} trying to withdraw\t${withdrawETH} ETH,\t${withdrawGNO} GNO`)

    // transaction returned early at Log('withdraw R1')
    await assertRejects(dx.withdraw(eth.address, withdrawETH, { from: acc }), 'can\'t withdraw from 0 ETH deposit')
    await assertRejects(dx.withdraw(gno.address, withdrawGNO, { from: acc }), 'can\'t withdraw from 0 GNO deposit')

    const { ETH: ETHDep2, GNO: GNODep2 } = await getAccDeposits(acc)

    logger(`${acc} deposits:\t${ETHDep2} ETH,\t${GNODep2} GNO`)

    assert.strictEqual(ETHDep1, ETHDep2, 'ETH deposit should not change')
    assert.strictEqual(GNODep1, GNODep2, 'GNO deposit should not change')
  })))
  
  it('rejects when trying to deposit more than balance available', () => Promise.all(testingAccs.map(async (acc) => {
    const { ETH: ETHBal1, GNO: GNOBal1 } = await getAccBalances(acc)
    const { ETH: ETHDep1, GNO: GNODep1 } = await getAccDeposits(acc)

    const depositETH = ETHBal1 + 10
    const depositGNO = GNOBal1 + 10

    logger(`${acc} trying to deposit\t${depositETH} ETH,\t${depositGNO} GNO\n\t10 more than balance available`)

    // transaction returned early at Log('deposit R1')
    await assertRejects(dx.deposit(eth.address, depositETH, { from: acc }), 'can\'t deposit more than ETH balance')
    await assertRejects(dx.deposit(gno.address, depositGNO, { from: acc }), 'can\'t deposit more than GNO balance')

    const { ETH: ETHDep2, GNO: GNODep2 } = await getAccDeposits(acc)

    logger(`${acc} deposits:\t${ETHDep2} ETH,\t${GNODep2} GNO`)
    assert.strictEqual(ETHDep1, ETHDep2, 'ETH deposit should not change')
    assert.strictEqual(GNODep1, GNODep2, 'GNO deposit should not change')
  })))

  it('rejects when trying to deposit more than allowance', () => Promise.all(testingAccs.map(async (acc) => {
    const { ETH: ETHAllow, GNO: GNOAllow } = await getAccAllowance(acc, dx.address)
    const { ETH: ETHDep1, GNO: GNODep1 } = await getAccDeposits(acc)

    const depositETH = ETHAllow + 10
    const depositGNO = GNOAllow + 10

    logger(`${acc} trying to deposit\t${depositETH} ETH,\t${depositGNO} GNO\n\t10 more than allowance`)

    // transaction returned early at Log('deposit R1')
    await assertRejects(dx.deposit(eth.address, depositETH, { from: acc }), 'can\'t deposit more than ETH allowance')
    await assertRejects(dx.deposit(gno.address, depositGNO, { from: acc }), 'can\'t deposit more than GNO allowance')

    const { ETH: ETHDep2, GNO: GNODep2 } = await getAccDeposits(acc)

    logger(`${acc} deposits:\t${ETHDep2} ETH,\t${GNODep2} GNO`)
    assert.strictEqual(ETHDep1, ETHDep2, 'ETH deposit should not change')
    assert.strictEqual(GNODep1, GNODep2, 'GNO deposit should not change')
  })))
})


/*
  const checkConstruction = async function () {
    // initial price is set
    let initialClosingPrice = await dx.closingPrices(0);
    initialClosingPrice = initialClosingPrice.map(x => x.toNumber());
    assert.deepEqual(initialClosingPrice, [2, 1], 'initialClosingPrice set correctly');

    // sell token is set
    const exchangeSellToken = await dx.sellToken();
    assert.equal(exchangeSellToken, sellToken.address, 'sellToken set correctly');

    // buy token is set
    const exchangeBuyToken = await dx.buyToken();
    assert.equal(exchangeBuyToken, buyToken.address, 'buyToken set correctly');

    // TUL token is set
    const exchangeTUL = await dx.TUL();
    assert.equal(exchangeTUL, TUL.address, 'TUL set correctly');

    // next auction is scheduled correctly
    await nextAuctionScheduled();
  }

  const approveAndSell = async function (amount) {
    const sellerBalancesBefore = (await dx.sellerBalances(1, seller)).toNumber();
    const sellVolumeBefore = (await dx.sellVolumeCurrent()).toNumber();

    await sellToken.approve(dxa, amount, { from: seller });
    await dx.postSellOrder(amount, { from: seller });

    const sellerBalancesAfter = (await dx.sellerBalances(1, seller)).toNumber();
    const sellVolumeAfter = (await dx.sellVolumeCurrent()).toNumber();

    assert.equal(sellerBalancesBefore + amount, sellerBalancesAfter, 'sellerBalances updated');
    assert.equal(sellVolumeBefore + amount, sellVolumeAfter, 'sellVolume updated');
  }

  const postSellOrders = async function () {
    await utils.assertRejects(approveAndBuy(50));
    await approveAndSell(50);
    await approveAndSell(50);
  }

  const approveAndBuy = async function (amount) {
    const buyerBalancesBefore = (await dx.buyerBalances(1, buyer)).toNumber();
    const buyVolumeBefore = (await dx.buyVolumes(1)).toNumber();

    await buyToken.approve(dxa, amount, { from: buyer });
    const price = (await dx.getPrice(1)).map(x => x.toNumber());

    await dx.postBuyOrder(amount, 1, { from: buyer });

    const buyerBalancesAfter = (await dx.buyerBalances(1, buyer)).toNumber();
    const buyVolumeAfter = (await dx.buyVolumes(1)).toNumber();

    assert.equal(buyerBalancesBefore + amount, buyerBalancesAfter, 'buyerBalances updated');
    assert.equal(buyVolumeBefore + amount, buyVolumeAfter, 'buyVolumes updated');
  }

  const approveBuyAndClaim = async function (amount) {
    const claimedAmountBefore = (await dx.claimedAmounts(1, buyer)).toNumber();
    const buyerBalancesBefore = (await dx.buyerBalances(1, buyer)).toNumber();
    const buyVolumeBefore = (await dx.buyVolumes(1)).toNumber();

    await buyToken.approve(dxa, amount, { from: buyer });
    const price = (await dx.getPrice(1)).map(x => x.toNumber());
    await dx.postBuyOrderAndClaim(amount, 1, { from: buyer });

    const claimedAmountAfter = (await dx.claimedAmounts(1, buyer)).toNumber();
    const buyerBalancesAfter = (await dx.buyerBalances(1, buyer)).toNumber();
    const expectedReturn = Math.floor(buyerBalancesAfter * price[1] / price[0]) - claimedAmountBefore;
    const buyVolumeAfter = (await dx.buyVolumes(1)).toNumber();

    assert.equal(expectedReturn + claimedAmountBefore, claimedAmountAfter, 'claimedAmounts updated');
    assert.equal(buyerBalancesBefore + amount, buyerBalancesAfter, 'buyerBalances updated');
    assert.equal(buyVolumeAfter, buyVolumeBefore + amount, 'buyVolumes updated');
  }

  const postBuyOrdersAndClaim = async function () {
    await approveAndBuy(50);
    await approveBuyAndClaim(25);
    await utils.assertRejects(approveAndSell(50));
    await auctionStillRunning();
  }

  const auctionStillRunning = async function () {
    const auctionIndex = (await dx.auctionIndex()).toNumber();
    assert.equal(auctionIndex, 1, 'auction index same');
  }

  const startAuction = async function () {
    const exchangeStart = (await dx.auctionStart()).toNumber();
    const now = (await dx.now()).toNumber();
    const timeUntilStart = exchangeStart - now;
    await dx.increaseTimeBy(1, timeUntilStart);
  }

  const runThroughAuctionBeforeClear = async function () {
    await checkConstruction();
    await postSellOrders();

    await startAuction();
    await postBuyOrdersAndClaim();
  }

  const clearAuctionWithTime = async function () {
    const buyVolume = (await dx.buyVolumes(1)).toNumber();
    const sellVolume = (await dx.sellVolumeCurrent()).toNumber();
    const auctionStart = (await dx.auctionStart()).toNumber();

    // Auction clears when sellVolume * price = buyVolume
    // Since price is a function of time, so we have to rearrange the equation for time, which gives
    timeWhenAuctionClears = Math.ceil(72000 * sellVolume / buyVolume - 18000 + auctionStart);
    await dx.setTime(timeWhenAuctionClears);
    const buyerBalance = (await dx.buyerBalances(1, buyer)).toNumber();

    await buyToken.approve(dxa, 1, { from: buyer });
    await dx.postBuyOrder(1, 1, { from: buyer });

    const buyVolumeAfter = (await dx.buyVolumes(1)).toNumber();
    const buyerBalanceAfter = (await dx.buyerBalances(1, buyer)).toNumber();

    // Nothing has been updated
    assert.equal(buyVolume, buyVolumeAfter, 'buyVolume constant');
    assert.equal(buyerBalance, buyerBalanceAfter, 'buyerBalance constant');

    // New auction has been scheduled
    await auctionCleared();
  }

  const clearAuctionWithBuyOrder = async function () {
    const buyerBalanceBefore = (await dx.buyerBalances(1, buyer)).toNumber();
    const buyVolumeBefore = (await dx.buyVolumes(1)).toNumber();
    const sellVolume = (await dx.sellVolumeCurrent()).toNumber();
    const auctionStart = (await dx.auctionStart()).toNumber();
    const price = (await dx.getPrice(1)).map(x => x.toNumber());

    // Auction clears when sellVolume * price = buyVolume
    // Solidity rounds down, so slightly less is required
    const amountToClearAuction = Math.floor(sellVolume * price[0] / price[1]) - buyVolumeBefore;
    // Let's add a little overflow to see if it handles it
    const amount = amountToClearAuction + 10;

    // It should subtract it before transferring

    await buyToken.approve(dxa, amount, { from: buyer });
    await dx.postBuyOrder(amount, 1, { from: buyer });

    const buyVolumeAfter = (await dx.buyVolumes(1)).toNumber();
    const buyerBalanceAfter = (await dx.buyerBalances(1, buyer)).toNumber();

    assert.equal(buyVolumeBefore + amountToClearAuction, buyVolumeAfter, 'buyVolume updated');
    assert.equal(buyerBalanceBefore + amountToClearAuction, buyerBalanceAfter, 'buyerBalances updated');

    // New auction has been scheduled
    await auctionCleared();
  }

  const claimBuyerFunds = async function () {
    const buyerBalance = (await dx.buyerBalances(1, buyer)).toNumber();
    const claimedAmountBefore = (await dx.claimedAmounts(1, buyer)).toNumber();

    await dx.claimBuyerFunds(1, { from: buyer });

    // Calculate returned value
    const price = (await dx.getPrice(1)).map(x => x.toNumber());
    const returned = Math.floor(buyerBalance * price[1] / price[0]) - claimedAmountBefore;
    const claimedAmountAfter = (await dx.claimedAmounts(1, buyer)).toNumber();

    assert.equal(claimedAmountBefore + returned, claimedAmountAfter, 'claimedAmount updated');

    // Follow-up claims should fail
    utils.assertRejects(dx.claimBuyerFunds(1, { from: buyer }));
  }

  const claimSellerFunds = async function () {
    const sellerBalance = (await dx.sellerBalances(1, seller)).toNumber();

    const claimReceipt = await dx.claimSellerFunds(1, { from: seller });

    const returned = claimReceipt.logs[0].args._returned.toNumber();

    const price = (await dx.getPrice(1)).map(x => x.toNumber());
    const expectedReturn = Math.floor(sellerBalance * price[0] / price[1]);
    assert.equal(expectedReturn, returned, 'returned correct amount');

    // Follow-up claims should fail
    utils.assertRejects(dx.claimSellerFunds(1, { from: seller }));
  }

  const auctionCleared = async function () {
    // Get exchange variables
    const price = (await dx.getPrice(1)).map(x => x.toNumber());
    const closingPrice = (await dx.closingPrices(1)).map(x => x.toNumber());
    const sellVolumeCurrent = (await dx.sellVolumeCurrent()).toNumber();
    const sellVolumeNext = (await dx.sellVolumeNext()).toNumber();
    const auctionIndex = (await dx.auctionIndex()).toNumber();

    // Variables have been updated
    assert.deepEqual(closingPrice, price);
    assert.equal(sellVolumeCurrent, 0);
    assert.equal(sellVolumeNext, 0);
    assert.equal(auctionIndex, 2);

    // Next auction scheduled
    await nextAuctionScheduled();
  }

  const nextAuctionScheduled = async function () {
    const exchangeStart = (await dx.auctionStart()).toNumber();
    const now = (await dx.now()).toNumber();
    assert(now < exchangeStart, 'auction starts in future');
    assert(now + 21600 >= exchangeStart, 'auction starts within 6 hrs');
  }

  it('runs correctly through auction until clearing', runThroughAuctionBeforeClear)

  it('clears auction with time', async function () {
    await runThroughAuctionBeforeClear();
    await clearAuctionWithTime();
  })

  it('claims funds correctly after clearing', async function () {
    await runThroughAuctionBeforeClear();
    await clearAuctionWithBuyOrder();

    await claimBuyerFunds();
    await claimSellerFunds();
  })

  it('claims funds correctly after new auction began', async function () {
    await runThroughAuctionBeforeClear();
    await clearAuctionWithBuyOrder();

    await startAuction();

    await claimBuyerFunds();
    await claimSellerFunds();
  }) */
