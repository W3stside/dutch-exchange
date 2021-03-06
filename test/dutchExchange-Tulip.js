/*
  eslint prefer-const: 0,
  max-len: 0,
  object-curly-newline: 1,
  no-param-reassign: 0,
  no-console: 0,
  no-mixed-operators: 0,
  no-floating-decimal: 0,
  no-trailing-spaces: 0,
  no-multi-spaces: 0,
*/

const TokenGNO2 = artifacts.require('TokenGNO')

const { 
  eventWatcher,
  log,
  gasLogger,
  timestamp,
  enableContractFlag,
} = require('./utils')

const {
  assertClaimingFundsCreatesTulips,
  assertReturnedPlusTulips,
  claimBuyerFunds,
  claimSellerFunds,
  getAuctionIndex,
  getBalance,
  getContracts,
  postBuyOrder,
  postSellOrder,
  setupTest,
  setAndCheckAuctionStarted,
  unlockTulipTokens,
  wait,
  waitUntilPriceIsXPercentOfPreviousPrice,
} = require('./testFunctions')

// Test VARS
let eth
let gno
let dx
let tokenTUL
let oracle
let contracts

const setupContracts = async () => {
  contracts = await getContracts();
  // destructure contracts into upper state
  ({
    DutchExchange: dx,
    EtherToken: eth,
    TokenGNO: gno,
    TokenTUL: tokenTUL,
    PriceOracleInterface: oracle,
  } = contracts)
}

const c1 = () => contract('DX Tulip Flow --> 1 Seller + 1 Buyer', (accounts) => {
  const [master, seller1, , buyer1] = accounts

  let seller1Balance, sellVolumes
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether') - $60,000USD
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })
  
  before('Before Hook', async () => {
    // get contracts
    await setupContracts()
    eventWatcher(dx, 'LogNumber', {})
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth) // dx.balances(token) - sellingAmt
    log(`\nSeller Balance ====> ${seller1Balance.toEth()}\n`)
    assert.equal(seller1Balance, startingETH - sellingAmount, `Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)
  })
  
  it('Check sellVolume', async () => {
    log(`
    =====================================
    T1: Check sellVolume
    =====================================
    `)

    sellVolumes = (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber()
    const svFee = f => sellingAmount * (f / 100)
    log(`
    SELLVOLUMES === ${sellVolumes.toEth()}
    FEE         === ${svFee(0.5).toEth()}
    `)
    assert.equal(sellVolumes, sellingAmount - svFee(0.5), 'sellVolumes === seller1Balance')
  })
  
  it('BUYER1: Non Auction clearing PostBuyOrder + Claim => Tulips = 0', async () => {
    eventWatcher(dx, 'ClaimBuyerFunds', {})
    eventWatcher(dx, 'LogNumber', {})
    log(`
    ============================================================================================
    T2.5: Buyer1 PostBuyOrder => [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]
    ============================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    /*
     * SUB TEST 1: MOVE TIME AFTER SCHEDULED AUCTION START TIME && ASSERT AUCTION-START =TRUE
     */
    await setAndCheckAuctionStarted(eth, gno)    
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)

    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    await postBuyOrder(eth, gno, false, (20).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    let idx = await getAuctionIndex()
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    log(`
    CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued, 0, 'Tulips only issued / minted after auction Close so here = 0')
  })

  it(
    'BUYER1: Tries to lock and unlock Tulips --> Auction NOT cleared --> asserts 0 Tulips minted and in mapping', 
    () => unlockTulipTokens(buyer1, eth, gno),
  )

  it('BUYER1: Auction clearing PostBuyOrder + Claim => Tulips = sellVolume', async () => {
    eventWatcher(dx, 'AuctionCleared')
    log(`
    ================================================================================================
    T3: Buyer1 PostBuyOrder => Auction clearing PostBuyOrder + Claim => Tulips = 99.5 || sellVolume
    ================================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `) 
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    // post buy order that CLEARS auction - 400 / 4 = 100 + 5 from before clears
    await postBuyOrder(eth, gno, false, (400).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    // drop it down 1 as Auction has cleared
    let idx = await getAuctionIndex() - 1
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    await assertClaimingFundsCreatesTulips(eth, gno, buyer1, 'buyer')
    log(`
    RETURNED//CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED           => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued.toEth(), 99.5, 'Tulips only issued / minted after auction Close so here = 99.5 || sell Volume')
  })

  it('Clear Auction, assert auctionIndex increase', async () => {
    log(`
    ================================================================================================
    T3.5: Buyer1 Check Auc Idx + Make sure Buyer1 has returned ETH in balance
    ================================================================================================
    `)
    /*
     * SUB TEST 1: clearAuction
     */ 
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    // just to close auction
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    log(`
    New Auction Index -> ${await getAuctionIndex()}
    `)
    assert.equal((await getBalance(buyer1, eth)), startBal.startingETH + sellVolumes, 'Buyer 1 has the returned value into ETHER + original balance')
    assert.isAtLeast(await getAuctionIndex(), 2)
  })

  it('BUYER1: ETH --> GNO: Buyer can lock tokens and only unlock them 24 hours later', async () => {
    // event listeners
    // eventWatcher(tokenTUL, 'NewTokensMinted')
    // eventWatcher(dx, 'AuctionCleared')
    log(`
    ============================================
    T4: Buyer1 - Locking and Unlocking of Tokens
    ============================================
    `)
    /*
     * SUB TEST 1: Try getting Tulips
     */ 
    // Claim Buyer Funds from auctionIdx 1
    await claimBuyerFunds(eth, gno, buyer1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(buyer1)
  })

  it('SELLER: ETH --> GNO: seller can lock tokens and only unlock them 24 hours later', async () => {
    log(`
    ============================================
    T5: Seller - Locking and Unlocking of Tokens
    ============================================
    `)
    log('seller BALANCE = ', (await getBalance(seller1, eth)).toEth())
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    // just to close auction
    await claimSellerFunds(eth, gno, seller1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(seller1)
  })
})

const c2 = () => contract('DX Tulip Flow --> 1 Seller + 2 Buyers', (accounts) => {
  const [master, seller1, buyer2, buyer1] = accounts
  // const user = seller1
  // let userTulips
  let seller1Balance, sellVolumes, buyer1Returns, buyer2Returns
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether')
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })

  before(async () => {
    // get contracts
    await setupContracts()
    eventWatcher(dx, 'LogNumber', {})
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth) // dx.balances(token) - sellingAmt
    log(`\nSeller Balance ====> ${seller1Balance.toEth()}\n`)
    assert.equal(seller1Balance, startingETH - sellingAmount, `Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)
  })
  
  // Checks that sellVolume * calculated FEE is correct
  it('Check sellVolume', async () => {
    log(`
    =====================================
    T1: Check sellVolume
    =====================================
    `)

    sellVolumes = (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber()
    const svFee = f => sellingAmount * (f / 100)
    log(`
    SELLVOLUMES === ${sellVolumes.toEth()}
    FEE         === ${svFee(0.5).toEth()}
    `)
    assert.equal(sellVolumes, sellingAmount - svFee(0.5), 'sellVolumes === seller1Balance')
  })
  
  // Starts the auction - sets block time to 1 sec AFTER auction time
  it('Start Auction', async () => {
    /*
     * SUB TEST 1: MOVE TIME AFTER SCHEDULED AUCTION START TIME && ASSERT AUCTION-START =TRUE
     */
    await setAndCheckAuctionStarted(eth, gno)
  })


  it('BUYER1: [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]', async () => {
    eventWatcher(dx, 'ClaimBuyerFunds')
    eventWatcher(dx, 'LogNumber')
    log(`
    ============================================================================================
    T-2a: Buyer1 PostBuyOrder => [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]
    ============================================================================================
    `)

    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    /*
     * SUB TEST 2: postBuyOrder => 200 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 200GNO * 1/4 => 50 ETHER
     */
    await postBuyOrder(eth, gno, false, (200).toWei(), buyer1)
    log(`\nBuy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}`)
    let idx = await getAuctionIndex()
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    log(`
    CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED => ${tulipsIssued.toEth()}
    `)
    
    assert.equal(tulipsIssued, 0, 'Tulips only issued / minted after auction Close so here = 0')
  })

  it('Move time and change price to 50% of 4:1 aka 2:1 aka Last Closing Price', async () => {
    /*
     * SUB TEST 2: Move time to 3:1 price
     * @ price 3:1 aka 1 GNO => 1/3 ETH && 1 ETH => 3 GNO
     * @{return} ... 20GNO * 1/3 => 6.6666 ETHER
     */
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1.5)
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    assert.isAtLeast((num / den), 2.899999)
  })

  it('BUYER2: Non Auction clearing PostBuyOrder + Claim => Tulips = 0', async () => {
    eventWatcher(dx, 'ClaimBuyerFunds', {})
    eventWatcher(dx, 'LogNumber', {})
    log(`
    ============================================================================================
    T-2b: Buyer1 PostBuyOrder => [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]
    ============================================================================================
    `)

    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer2, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer2, eth)).toEth()}
    `)
    
    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 3:1 price
     * post buy order @ price 3:1 aka 1 GNO => 1/3 ETH && 1 ETH => 3 GNO
     * @{return} ... 100GNO * 1/3 => 33.333 ETHER
     */
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    await postBuyOrder(eth, gno, false, (40).toWei(), buyer2)
    log(`
    Buy Volume AFTER      = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()} GNO
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()} ETH
    `)
    
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer2, 1)).map(i => i.toNumber())
    log(`
    CLAIMED FUNDS => ${claimedFunds.toEth()} ETH
    TULIPS ISSUED => ${tulipsIssued.toEth()} TUL
    `)

    assert.equal(tulipsIssued, 0, 'Tulips only issued / minted after auction Close so here = 0')
  })

  it('BUYER1: Auction clearing PostBuyOrder + Claim => Tulips = sellVolume', async () => {
    eventWatcher(dx, 'AuctionCleared')
    log(`
    ================================================================================================
    T3: Buyer1 PostBuyOrder => Auction clearing PostBuyOrder + Claim => Tulips = 99.5 || sellVolume
    ================================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `) 
    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)

    // post buy order that CLEARS auction - 400 / 4 = 100 + 5 from before clears
    await postBuyOrder(eth, gno, false, (400).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    let idx = await getAuctionIndex() - 1
    const [b1ClaimedFunds, b1TulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    const [b2ClaimedFunds, b2TulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer2, idx)).map(i => i.toNumber())
    buyer1Returns = b1TulipsIssued
    buyer2Returns = b2TulipsIssued

    // Buyer1 Claim
    await assertClaimingFundsCreatesTulips(eth, gno, buyer1, 'buyer')
    // Buyer2 Claim
    await assertClaimingFundsCreatesTulips(eth, gno, buyer2, 'buyer')

    // Save return amt into state since TUL 1:1 w/ETH
    log(`
    Buyer 1
    RETURNED//CLAIMED FUNDS => ${b1ClaimedFunds.toEth()}
    TULIPS ISSUED           => ${b1TulipsIssued.toEth()}
    `)

    log(`
    Buyer 2
    RETURNED//CLAIMED FUNDS => ${b2ClaimedFunds.toEth()}
    TULIPS ISSUED           => ${b2TulipsIssued.toEth()}
    `)

    // assert both amount of tulips issued = sellVolume
    assert.equal((b1TulipsIssued + b2TulipsIssued).toEth(), 99.5, 'Tulips only issued / minted after auction Close so here = 99.5 || sell Volume')
  })

  it('Clear Auction, assert auctionIndex increase', async () => {
    log(`
    ================================================================================================
    T3.5: Buyer1 Check Auc Idx + Make sure Buyer1 has returned ETH in balance
    ================================================================================================
    `)
    /*
     * SUB TEST 1: clearAuction
     */ 
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    // just to close auction
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    log(`
    New Auction Index -> ${await getAuctionIndex()}
    `)

    assert.equal(((await getBalance(buyer1, eth)).toEth()).toFixed(2), ((startBal.startingETH + buyer1Returns).toEth()).toFixed(2), 'Buyer 1 has the returned value into ETHER + original balance')
    assert.equal(((await getBalance(buyer2, eth)).toEth()).toFixed(2), ((startBal.startingETH + buyer2Returns).toEth()).toFixed(2), 'Buyer 2 has the returned value into ETHER + original balance')
    assert.equal(await getAuctionIndex(), 2)
  })

  it('BUYER1: ETH --> GNO: user can lock tokens and only unlock them 24 hours later', async () => {
    // event listeners
    // eventWatcher(tokenTUL, 'NewTokensMinted')
    // eventWatcher(dx, 'AuctionCleared')
    log(`
    ============================================
    T-4a: Buyer1 - Locking and Unlocking of Tokens
    ============================================
    `)
    /*
     * SUB TEST 1: Try getting Tulips
     */ 
    // Claim Buyer Funds from auctionIdx 1
    await claimBuyerFunds(eth, gno, buyer1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(buyer1)
  })

  it('BUYER2: ETH --> GNO: user can lock tokens and only unlock them 24 hours later', async () => {
    // event listeners
    // eventWatcher(tokenTUL, 'NewTokensMinted')
    // eventWatcher(dx, 'AuctionCleared')
    log(`
    ============================================
    T-4b: Buyer2 - Locking and Unlocking of Tokens
    ============================================
    `)
    /*
     * SUB TEST 1: Try getting Tulips
     */ 
    // Claim Buyer Funds from auctionIdx 1
    await claimBuyerFunds(eth, gno, buyer2, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(buyer2)
  })

  it('SELLER: ETH --> GNO: seller can lock tokens and only unlock them 24 hours later', async () => {
    log(`
    ============================================
    T5: Seller - Locking and Unlocking of Tokens
    ============================================
    `)
    log('seller BALANCE = ', (await getBalance(seller1, eth)).toEth())
    await claimSellerFunds(eth, gno, seller1, 1)
    await unlockTulipTokens(seller1)
  })
})

const c3 = () => contract('DX Tulip Flow --> withdrawUnlockedTokens', (accounts) => {
  const [master, seller1, , buyer1] = accounts
  // const user = seller1
  // let userTulips
  let seller1Balance, sellVolumes
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether')
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal

  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })

  before(async () => {
    // get contracts
    await setupContracts()
    eventWatcher(dx, 'LogNumber', {})
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth) // dx.balances(token) - sellingAmt
    log(`\nSeller Balance ====> ${seller1Balance.toEth()}\n`)
    assert.equal(seller1Balance, startingETH - sellingAmount, `Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)
  })
  
  it('Check sellVolume', async () => {
    log(`
    =====================================
    T1: Check sellVolume
    =====================================
    `)

    sellVolumes = (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber()
    const svFee = f => sellingAmount * (f / 100)
    log(`
    SELLVOLUMES === ${sellVolumes.toEth()}
    FEE         === ${svFee(0.5).toEth()}
    `)
    assert.equal(sellVolumes, sellingAmount - svFee(0.5), 'sellVolumes === seller1Balance')
  })
  
  it('BUYER1: Non Auction clearing PostBuyOrder + Claim => Tulips = 0', async () => {
    eventWatcher(dx, 'ClaimBuyerFunds', {})
    eventWatcher(dx, 'LogNumber', {})
    log(`
    ============================================================================================
    T2.5: Buyer1 PostBuyOrder => [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]
    ============================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    /*
     * SUB TEST 1: MOVE TIME AFTER SCHEDULED AUCTION START TIME && ASSERT AUCTION-START =TRUE
     */
    await setAndCheckAuctionStarted(eth, gno)    
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)

    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    await postBuyOrder(eth, gno, false, (20).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    let idx = await getAuctionIndex()
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    log(`
    CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued, 0, 'Tulips only issued / minted after auction Close so here = 0')
  })

  it(
    'BUYER1: Tries to lock and unlock Tulips --> Auction NOT cleared --> asserts 0 Tulips minted and in mapping', 
    () => unlockTulipTokens(buyer1),
  )

  it('BUYER1: Auction clearing PostBuyOrder + Claim => Tulips = sellVolume', async () => {
    eventWatcher(dx, 'AuctionCleared')
    log(`
    ================================================================================================
    T3: Buyer1 PostBuyOrder => Auction clearing PostBuyOrder + Claim => Tulips = 99.5 || sellVolume
    ================================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `) 
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(eth.address, gno.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    // post buy order that CLEARS auction - 400 / 4 = 100 + 5 from before clears
    await postBuyOrder(eth, gno, false, (400).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    // drop it down 1 as Auction has cleared
    let idx = await getAuctionIndex() - 1
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(eth.address, gno.address, buyer1, idx)).map(i => i.toNumber())
    await assertClaimingFundsCreatesTulips(eth, gno, buyer1, 'buyer')
    log(`
    RETURNED//CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED           => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued.toEth(), 99.5, 'Tulips only issued / minted after auction Close so here = 99.5 || sell Volume')
  })

  it('Clear Auction, assert auctionIndex increase', async () => {
    log(`
    ================================================================================================
    T3.5: Buyer1 Check Auc Idx + Make sure Buyer1 has returned ETH in balance
    ================================================================================================
    `)
    /*
     * SUB TEST 1: clearAuction
     */ 
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    // just to close auction
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    log(`
    New Auction Index -> ${await getAuctionIndex()}
    `)
    assert.equal((await getBalance(buyer1, eth)), startBal.startingETH + sellVolumes, 'Buyer 1 has the returned value into ETHER + original balance')
    assert.isAtLeast(await getAuctionIndex(), 2)
  })

  it('BUYER1: ETH --> GNO: Buyer can lock tokens and only unlock them 24 hours later', async () => {
    // event listeners
    // eventWatcher(tokenTUL, 'NewTokensMinted')
    // eventWatcher(dx, 'AuctionCleared')
    log(`
    ============================================
    T4: Buyer1 - Locking and Unlocking of Tokens
    ============================================
    `)
    /*
     * SUB TEST 1: Try getting Tulips
     */ 
    // Claim Buyer Funds from auctionIdx 1
    await claimBuyerFunds(eth, gno, buyer1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(buyer1)
  })

  it('SELLER: ETH --> GNO: seller can lock tokens and only unlock them 24 hours later', async () => {
    log(`
    ============================================
    T5: Seller - Locking and Unlocking of Tokens
    ============================================
    `)
    log('seller BALANCE = ', (await getBalance(seller1, eth)).toEth())
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    // just to close auction
    await claimSellerFunds(eth, gno, seller1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(seller1)
  })

  it('BUYER1: Unlocked TUL tokens can be Withdrawn and Balances show for this', async () => {
    // TUL were minted
    // TUL were locked
    // TUL were UNLOCKED - starts 24h countdown
    // withdraw time MUST be < NOW aka TUL can be withdrawn

    /**
     * Sub-Test 1: 
     * assert amount unlocked is not 0
     * move time 24 hours
     * assert withdrawTime is < now
     */
    const [amountUnlocked, withdrawTime] = (await tokenTUL.unlockedTULs.call(buyer1)).map(n => n.toNumber())
    assert(amountUnlocked !== 0 && amountUnlocked === sellVolumes, 'Amount unlocked isnt 0 aka there are tulips')
    // wait 24 hours
    await wait(86405)
    log(`
    amt unlocked  ==> ${amountUnlocked.toEth()}
    withdrawTime  ==> ${withdrawTime} ==> ${new Date(withdrawTime * 1000)}
    time now      ==> ${timestamp()}  ==> ${new Date(timestamp() * 1000)}
    `)
    assert(withdrawTime < timestamp(), 'withdrawTime must be < now')
    // withdraw them!
    await tokenTUL.withdrawUnlockedTokens({ from: buyer1 })
    /**
     * Sub Test 2:
     * assert balance[user] of TUL != 0
     */
    const userTULBalance = (await tokenTUL.balanceOf.call(buyer1)).toNumber()
    log(`
    BUYER1 TUL Balance ===> ${userTULBalance.toEth()}
    `)
    assert(userTULBalance > 0 && userTULBalance === sellVolumes, 'Buyer1 should have non 0 Token TUL balances')
  })

  it('SELLER1: Unlocked TUL tokens can be Withdrawn and Balances show for this', async () => {
    /**
     * Sub-Test 1: 
     * assert amount unlocked is not 0
     * move time 24 hours
     * assert withdrawTime is < now
     */
    const [amountUnlocked, withdrawTime] = (await tokenTUL.unlockedTULs.call(seller1)).map(n => n.toNumber())
    assert(amountUnlocked !== 0 && amountUnlocked === sellVolumes, 'Amount unlocked isnt 0 aka there are tulips')
    // wait 24 hours
    await wait(86405)
    log(`
    amt unlocked  ==> ${amountUnlocked.toEth()}
    withdrawTime  ==> ${withdrawTime} ==> ${new Date(withdrawTime * 1000)}
    time now      ==> ${timestamp()}  ==> ${new Date(timestamp() * 1000)}
    `)
    assert(withdrawTime < timestamp(), 'withdrawTime must be < now')
    // withdraw them!
    await tokenTUL.withdrawUnlockedTokens({ from: seller1 })
    /**
     * Sub Test 2:
     * assert balance[user] of TUL != 0
     */
    const userTULBalance = (await tokenTUL.balanceOf.call(seller1)).toNumber()
    log(`
    seller1 TUL Balance ===> ${userTULBalance.toEth()}
    `)
    assert(userTULBalance > 0 && userTULBalance === sellVolumes, 'seller1 should have non 0 Token TUL balances')
  })
})

const c4 = () => contract('DX Tulip Flow --> change Owner', (accounts) => {
  const [master, seller1] = accounts
  // const user = seller1
  // let userTulips
  let seller1Balance
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether')
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal

  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })

  before(async () => {
    // get contracts
    await setupContracts()
    eventWatcher(dx, 'LogNumber', {})
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth) // dx.balances(token) - sellingAmt
    log(`\nSeller Balance ====> ${seller1Balance.toEth()}\n`)
    assert.equal(seller1Balance, startingETH - sellingAmount, `Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)
  })

  it('CHANGING OWNER AND MINTER: changes TUL_OWNER from Master to Seller1 --> changes TUL_MINTER from NEW OWNER seller1 to seller1', async () => {
    const originalTULOwner = await tokenTUL.owner.call()
    await tokenTUL.updateOwner(seller1, { from: master })
    const newTULOwner = await tokenTUL.owner.call()

    assert(originalTULOwner === master, 'Original owner should be accounts[0] aka master aka migrations deployed acct for tokenTUL')
    assert(newTULOwner === seller1, 'New owner should be accounts[1] aka seller1')

    // set new Minter as seller1 - must come from TUL owner aka seller1
    await tokenTUL.updateMinter(seller1, { from: newTULOwner })
    const newTULMInter = await tokenTUL.minter.call()

    // assert.equal(originalTULMinter, master, 'Original owner should be accounts[0] aka master aka migrations deployed acct for tokenTUL')
    assert.equal(newTULMInter, seller1, 'New owner should be accounts[1] aka seller1')
  })
})

const c5 = () => contract('DX Tulip Flow --> 2 Sellers || Tulip issuance', (accounts) => {
  const [master, seller1, seller2, buyer1, seller3] = accounts
  const sellers = [seller1, seller2]
  // const user = seller1
  // let userTulips
  let seller1Balance, seller2Balance, sellVolumes
  let seller3SellAmount
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether')
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal

  before('Before checks', async () => {
    // get contracts
    await setupContracts()
    eventWatcher(dx, 'LogNumber', {});
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    ([seller1Balance, seller2Balance] = await Promise.all(sellers.map(s => getBalance(s, eth))))
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')
    assert.equal(seller2Balance, 0, 'Seller2 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal);

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    ([seller1Balance, seller2Balance] = await Promise.all(sellers.map(s => getBalance(s, eth))))
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)
    assert.equal(seller2Balance, startingETH, `Seller2 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    );

    ([seller1Balance, seller2Balance] = await Promise.all(sellers.map(s => getBalance(s, eth))))
    assert.equal(seller1Balance, startingETH - sellingAmount, `Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)
    assert.equal(seller2Balance, startingETH, `Seller2 should still have balance of ${startingETH.toEth()}`)
  })
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })

  it('Seller2 posts sell order in same auction ... ', async () => {
    let aucIdx = await getAuctionIndex()
    await dx.postSellOrder(eth.address, gno.address, aucIdx, sellingAmount, { from: seller2 })
    sellVolumes = (await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber()

    const postFeeSV = fee => ((sellingAmount * sellers.length) * (1 - (fee / 100))).toEth()

    log(`
    sV ==> ${sellVolumes.toEth()}
    `)

    assert.equal(sellVolumes.toEth(), postFeeSV(0.5), `SV should = ${sellingAmount.toEth() * 2}`)
  })

  it('Seller 3 posts a different amount', async () => { 
    seller3SellAmount = 50..toWei()
    await dx.postSellOrder(eth.address, gno.address, 1, seller3SellAmount, { from: seller3 })
  })

  it('Move forward in time to end auction', async () => {
    // price is ~~ 2:1
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1)
    await postBuyOrder(eth, gno, 1, 600..toWei(), buyer1)

    const aucIdx = await getAuctionIndex()
    assert(aucIdx === 2, 'Auc ended and moved +1 idx')
  })

  it('Sellers 1 and 2 can take out their equal share of Tulips', () => 
    Promise.all(sellers.map(async (seller) => {
      await claimSellerFunds(eth, gno, seller, 1)
      let tulBal = (await tokenTUL.lockedTULBalances.call(seller)).toNumber()
      log(tulBal)

      assert.equal(tulBal, sellVolumes / 2, 'Tulips minted should equal each sellers\' amount posted after FEES')
    })))
  
  it('Seller 3 can take out their smaller share', async () => {
    await claimSellerFunds(eth, gno, seller3, 1)
    const tulBal = (await tokenTUL.lockedTULBalances.call(seller3)).toNumber()
    log(tulBal)

    assert.equal(tulBal, seller3SellAmount * 0.995, 'Seller 3 balance is their sell amount * fee')
  })  
})  

const c6 = () => contract('DX Tulip Flow --> 1 SellOrder && 1 BuyOrder', (accounts) => {
  const [master, seller1, , buyer1] = accounts

  // let userTulips
  let seller1Balance
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether')
  }
  const { 
    startingETH,
    sellingAmount,
    // startingGNO,
    // ethUSDPrice,
  } = startBal
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })
  
  it('SET UP STATE --> addTokenPair', async () => {
    await setupContracts()
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')
    
    // allow the start of an auction w/no threshold
    await dx.updateExchangeParams(master, oracle.address, 0, 0, { from: master })

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      0,                 // 100 ether - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      0,                // buyVolume for GNO
      2,               // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth) // dx.balances(token) - sellingAmt
    log(`\nSeller Balance ====> ${seller1Balance.toEth()}\n`)
    assert.equal(seller1Balance.toEth(), seller1Balance.toEth(), `Seller1 should have ${seller1Balance} balance after new Token Pair add`)
  })

  it('1st --> POST SELL ORDER', async () => postSellOrder(eth, gno, 0, 5..toWei(), seller1))

  it('2nd --> POST SELL ORDER', async () => postSellOrder(eth, gno, 0, 5..toWei(), seller1))

  it('START AUCTION', async () => setAndCheckAuctionStarted(eth, gno))

  it('1st --> POST BUY ORDER', async () => postBuyOrder(eth, gno, 1, 1..toWei(), buyer1))

  it('2nd --> POST BUY ORDER', async () => postBuyOrder(eth, gno, 1, 1..toWei(), buyer1))

  it('WAIT UNTIL PRICE IS 2:1 <was 4:1>', async () => waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 1))

  it('CLEAR AUCTION W/BUY ORDER', async () => postBuyOrder(eth, gno, 1, 400..toWei(), buyer1))

  it('ASSERTS AUCTION IDX === 2', async () => assert.equal(await getAuctionIndex(), 2, 'AucIdx should = 2'))
})

const c7 = () => contract('DX Tulip Flow --> ERC20:ERC20 --> 1 S + 1B', (accounts) => {
  const [master, seller1, seller2, buyer1] = accounts
  const participants = accounts.slice(1)
  const sellers = [seller1, seller2]
  let seller1Balance, seller2Balance
  let gno2

  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    startingGNO2: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 10..toWei(), // Same as web3.toWei(50, 'gno')
    buyingAmount: 5..toWei(),
  }
  const { 
    startingETH,
    sellingAmount,
    startingGNO,
    startingGNO2,
    // ethUSDPrice,
  } = startBal

  before('Before checks', async () => {
    // get contracts
    await setupContracts();
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    ([seller1Balance, seller2Balance] = await Promise.all(sellers.map(s => getBalance(s, gno))))
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')
    assert.equal(seller2Balance, 0, 'Seller2 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    // create new ERC20 token &&
    // assign said token to gasLogger contracts obj
    contracts.gno2 = await TokenGNO2.new(10000..toWei(), { from: master });
    ({ gno2 } = contracts)

    // fund gno2 - deposit in DX
    await Promise.all(participants.map((acc) => {
      gno2.transfer(acc, startingGNO2, { from: master })
      gno2.approve(dx.address, startingGNO2, { from: acc })
    }))
    await Promise.all(participants.map(acc => dx.deposit(gno2.address, startingGNO2, { from: acc })));

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    ([seller1Balance, seller2Balance] = await Promise.all(sellers.map(s => getBalance(s, gno))))
    assert.equal(seller1Balance, startingGNO, `Seller1 should have balance of ${startingGNO.toEth()}`)
    assert.equal(seller2Balance, startingGNO, `Seller2 should have balance of ${startingGNO.toEth()}`)
    // Assert GNO2 balance is NOT 0
    await Promise.all(participants.map(async acc => assert.isAbove(await dx.balances.call(gno2.address, acc), 0, 'Should not have 0 balance')))

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })
    // approve GNO2
    await dx.updateApprovalOfToken(gno2.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno2.address), true, 'GNO2 is approved by DX')

    // add tokenPair ETH GNO
    await dx.addTokenPair(
      eth.address,
      gno.address,
      10.0.toWei(),      // 10 - sellVolume for token1 - takes Math.min of amt passed in OR seller balance
      5.0.toWei(),      // starting buyVolume for token2
      2,               // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH - sellingAmount, `ETH///GNO: Seller1 should have ${startingETH.toEth()} balance after new Token Pair add`)

    // add tokenPair ETH GNO2
    await dx.addTokenPair(
      eth.address,
      gno2.address,
      10.0.toWei(),      // 10 - sellVolume for token1 - takes Math.min of amt passed in OR seller balance
      5.0.toWei(),      // starting buyVolume for token2
      1,               // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, eth)
    assert.equal(seller1Balance, startingETH - (sellingAmount * 2), `ETH//GNO2: Seller1 should have ${startingGNO.toEth()} balance after new Token Pair add`)

    // add tokenPair GNO GNO2
    await dx.addTokenPair(
      gno.address,
      gno2.address,
      10.0.toWei(),      // 10 - sellVolume for token1 - takes Math.min of amt passed in OR seller balance
      1.0.toWei(),      // starting buyVolume for token2
      1,               // lastClosingPrice NUM
      2,              // lastClosingPrice DEN
      { from: seller1 },
    )
    seller1Balance = await getBalance(seller1, gno)
    assert.isAtLeast(seller1Balance.toEth(), (startingGNO - (sellingAmount + 5.0.toWei())).toEth(), `GNO//GNO2: Seller1 should have ${startingGNO.toEth()} balance after new Token Pair add`)
  })
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })

  it('ETH//GNO: Wait until price is low then CLOSE AUCTION', async () => {
    // grab current auction Index
    const startingAI = await getAuctionIndex(eth, gno)
    // move to 2:1 price (250 GNO => 125 ETHER)
    await setAndCheckAuctionStarted(eth, gno)
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno, 0.5)

    await postBuyOrder(eth, gno, 1, 100.0.toWei(), buyer1)
    // clear recip
    await postBuyOrder(gno, eth, 1, 100.0.toWei(), buyer1)
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(eth.address, gno.address, 1)).map(i => i.toNumber())
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(eth.address, gno.address)).toNumber() - ((await dx.buyVolumes.call(eth.address, gno.address)).toNumber()) * (den / num)).toEth()}
    `)
    const assertingAI = await getAuctionIndex(eth, gno)
    assert.equal(assertingAI, startingAI + 1, `Current Auction Index should == ${startingAI} + 1`)
  })

  it('ETH//GNO2: Wait until price is low then CLOSE AUCTION', async () => {
    // grab current auction Index
    const startingAI = await getAuctionIndex(eth, gno2)
    await setAndCheckAuctionStarted(eth, gno2)
    // move to 2:1 price (250 GNO => 125 ETHER)
    await waitUntilPriceIsXPercentOfPreviousPrice(eth, gno2, 0.5)

    // clear main
    await postBuyOrder(eth, gno2, 1, 100.0.toWei(), buyer1)
    // clear recip auction
    await postBuyOrder(gno2, eth, 1, 100.0.toWei(), buyer1)
    const assertingAI = await getAuctionIndex(eth, gno2)
    assert.equal(assertingAI, startingAI + 1, `Current Auction Index should == ${startingAI} + 1`)
  })

  it('GNO//GNO2: Wait until price is low then CLOSE AUCTION', async () => {
    // grab current auction Index
    const startingAI = await getAuctionIndex(gno, gno2)
    await setAndCheckAuctionStarted(gno, gno2)
    // move to 2:1 price (250 GNO => 125 ETHER)
    await waitUntilPriceIsXPercentOfPreviousPrice(gno, gno2, 0.2)

    // clear main auc
    await postBuyOrder(gno, gno2, 1, 25.0.toWei(), buyer1)
    // clear recip
    await postBuyOrder(gno2, gno, 1, 25.0.toWei(), buyer1)
    const assertingAI = await getAuctionIndex(gno, gno2)
    assert.equal(assertingAI, startingAI + 1, `Current Auction Index should == ${startingAI} + 1`)
  })

  it('Calculate that PROPER Tulip amt is minted', async () => {
    // assuming all auctions: E/G, E/G2, G/G2 are CLOSED
    /** Tulip minting guide
     * ETH/ERC20 
     * --> Buyer (ERC20)
     * ------> Tulip = buyerBalance * (price.den / price.num) <== closingPrice
     * --> Seller (ETH)
     * ------> Tulip = sellerBalance (1:1 conversion)
     * 
     * ERC20/ETH
     * --> Buyer (ETH)
     * ------> Tulip = buyerBalance (1:1 conversion)
     * --> Seller (ERC20)
     * ------> Tulip = returned AKA sellerBalance * (price.num / price.den)
     * 
     * ERC20/ERC20
     * --> Buyer (ERC20)
     * ------> Tulip = buyerBalance * (priceETHden / priceETHnum)
     * --> Seller (ERC20)
     * ------> Tulip = returned AKA sellerBalance * (price.num / price.den)
     * 
     */
    
    // seller
    await assertReturnedPlusTulips(eth, gno, seller1, 'seller')
    await assertReturnedPlusTulips(eth, gno2, seller1, 'seller')
    await assertReturnedPlusTulips(gno, gno2, seller1, 'seller')

    // buyer
    await assertReturnedPlusTulips(eth, gno, buyer1, 'buyer')
    await assertReturnedPlusTulips(eth, gno2, buyer1, 'buyer')
    await assertReturnedPlusTulips(gno, gno2, buyer1, 'buyer')
  })

  it('Buyer1 => can claim all TULIPS from all auctions', async () => {
    // ETH/GNO
    await assertClaimingFundsCreatesTulips(eth, gno, buyer1, 'buyer')
    // ETH/GNO2
    await assertClaimingFundsCreatesTulips(eth, gno2, buyer1, 'buyer')
    // GNO/GNO2
    await assertClaimingFundsCreatesTulips(gno, gno2, buyer1, 'buyer')
  })
  
  it('Seller1 can take out his/her share of TUL', async () => {
    // ETH/GNO
    await assertClaimingFundsCreatesTulips(eth, gno, seller1, 'seller')
    // ETH/GNO2
    await assertClaimingFundsCreatesTulips(eth, gno2, seller1, 'seller')
    // GNO/GNO2
    await assertClaimingFundsCreatesTulips(gno, gno2, seller1, 'seller')
  })  
})

const c8 = () => contract('DX Tulip Flow --> Seller ERC20/ETH', (accounts) => {
  const [master, seller1, , buyer1, buyer2] = accounts

  let seller1Balance, sellVolumes
  
  const startBal = {
    startingETH: 1000..toWei(),
    startingGNO: 1000..toWei(),
    ethUSDPrice: 6000..toWei(),   // 400 ETH @ $6000/ETH = $2,400,000 USD
    sellingAmount: 100..toWei(), // Same as web3.toWei(50, 'ether') - $60,000USD
  }
  const { 
    startingETH,
    sellingAmount,
    startingGNO,
    // ethUSDPrice,
  } = startBal
  
  afterEach(() => { 
    gasLogger() 
    eventWatcher.stopWatching()
  })
  
  before('Before Hook', async () => {
    // get contracts
    await setupContracts()
    /*
     * SUB TEST 1: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, gno)
    assert.equal(seller1Balance, 0, 'Seller1 should have 0 balance')

    // set up accounts and tokens[contracts]
    await setupTest(accounts, contracts, startBal)

    /*
     * SUB TEST 2: Check passed in ACCT has NO balances in DX for token passed in
     */
    seller1Balance = await getBalance(seller1, gno)
    assert.equal(seller1Balance, startingGNO, `Seller1 should have balance of ${startingETH.toEth()}`)

    /*
     * SUB TEST 3: assert both eth and gno get approved by DX
     */
    // approve ETH
    await dx.updateApprovalOfToken(eth.address, true, { from: master })
    // approve GNO
    await dx.updateApprovalOfToken(gno.address, true, { from: master })

    assert.equal(await dx.approvedTokens.call(eth.address), true, 'ETH is approved by DX')
    assert.equal(await dx.approvedTokens.call(gno.address), true, 'GNO is approved by DX')

    /*
     * SUB TEST 4: create new token pair and assert Seller1Balance = 0 after depositing more than Balance
     */
    // add tokenPair ETH GNO
    log('Selling amt ', sellingAmount.toEth())
    await dx.addTokenPair(
      eth.address,
      gno.address,
      sellingAmount,  // 100 amt - sellVolume for ETH - takes Math.min of amt passed in OR seller balance
      sellingAmount / 4,              // buyVolume for GNO
      2,              // lastClosingPrice NUM
      1,              // lastClosingPrice DEN
      { from: seller1 },
    )
  })
  
  it('Check sellVolume', async () => {
    log(`
    =====================================
    T1: Check sellVolume
    =====================================
    `)

    sellVolumes = (await dx.sellVolumesCurrent.call(gno.address, eth.address)).toNumber()
    const svFee = f => (sellingAmount / 4) * (f / 100)
    log(`
    SELLVOLUMES === ${sellVolumes.toEth()}
    FEE         === ${svFee(0.5).toEth()}
    `)
    assert.equal(sellVolumes, (sellingAmount / 4) - svFee(0.5), 'sellVolumes === seller1Balance')
  })
  
  it('BUYER1: Non Auction clearing PostBuyOrder + Claim => Tulips = 0', async () => {
    log(`
    ============================================================================================
    T2.5: Buyer1 PostBuyOrder => [[Non Auction clearing PostBuyOrder + Claim]] => [[Tulips = 0]]
    ============================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    /*
     * SUB TEST 1: MOVE TIME AFTER SCHEDULED AUCTION START TIME && ASSERT AUCTION-START =TRUE
     */
    await setAndCheckAuctionStarted(gno, eth)    
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(gno.address, eth.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(gno.address, eth.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)

    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    await postBuyOrder(gno, eth, false, (20).toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(gno.address, eth.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(gno.address, eth.address)).toNumber() - ((await dx.buyVolumes.call(gno.address, eth.address)).toNumber()) * (den / num)).toEth()}
    `)
    let idx = await getAuctionIndex()
    const [claimedFunds, tulipsIssued] = (await dx.claimBuyerFunds.call(gno.address, eth.address, buyer1, idx)).map(i => i.toNumber())
    log(`
    CLAIMED FUNDS => ${claimedFunds.toEth()}
    TULIPS ISSUED => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued, 0, 'Tulips only issued / minted after auction Close so here = 0')
  })

  it(
    'BUYER1: Tries to lock and unlock Tulips --> Auction NOT cleared --> asserts 0 Tulips minted and in mapping', 
    () => unlockTulipTokens(buyer1, gno, eth),
  )

  it('BUYER1: Auction clearing PostBuyOrder + Claim => Tulips = sellVolume', async () => {
    eventWatcher(dx, 'AuctionCleared')
    log(`
    ================================================================================================
    T3: Buyer1 PostBuyOrder => Auction clearing PostBuyOrder + Claim => Tulips = 99.5 || sellVolume
    ================================================================================================
    `)
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `) 
    
    // Should be 0 here as aucIdx = 1 ==> we set aucIdx in this case
    const [closingNum, closingDen] = (await dx.closingPrices.call(gno.address, eth.address, 1))
    // Should be 4 here as closing price starts @ 2 and we times by 2
    const [num, den] = (await dx.getPriceForJS.call(gno.address, eth.address, 1)).map(i => i.toNumber())
    log(`
    Last Closing Prices:
    closeN        = ${closingNum}
    closeD        = ${closingDen}
    closingPrice  = ${closingNum / closingDen}
    ===========================================
    Current Prices:
    n             = ${num}
    d             = ${den}
    price         = ${num / den}
    `)
    /*
     * SUB TEST 2: postBuyOrder => 20 GNO @ 4:1 price
     * post buy order @ price 4:1 aka 1 GNO => 1/4 ETH && 1 ETH => 4 GNO
     * @{return} ... 20GNO * 1/4 => 5 ETHER
     */
    // post buy order that CLEARS auction - 400 / 4 = 100 + 5 from before clears
    await postBuyOrder(gno, eth, false, 5..toWei(), buyer1)
    log(`
    Buy Volume AFTER = ${((await dx.buyVolumes.call(gno.address, eth.address)).toNumber()).toEth()}
    Left to clear auction = ${((await dx.sellVolumesCurrent.call(gno.address, eth.address)).toNumber() - ((await dx.buyVolumes.call(gno.address, eth.address)).toNumber()) * (den / num)).toEth()}
    `)
    // drop it down 1 as Auction has cleared
    let idx = await getAuctionIndex() - 1
    
    // clear RECIP auction via buyer2
    await postBuyOrder(eth, gno, 1, 800..toWei(), buyer2)
    
    const [returned, tulipsIssued] = (await dx.claimBuyerFunds.call(gno.address, eth.address, buyer1, idx)).map(i => i.toNumber())
    await assertClaimingFundsCreatesTulips(gno, eth, buyer1, 'buyer')
    log(`
    RETURNED//CLAIMED FUNDS => ${returned.toEth()}
    TULIPS ISSUED           => ${tulipsIssued.toEth()}
    `)

    assert.equal(tulipsIssued.toEth(), returned, 'Tulips only issued / minted after auction Close and are equal to returned amount')
  })

  it('Clear Auction, assert auctionIndex increase', async () => {
    log(`
    ================================================================================================
    T3.5: Buyer1 Check Auc Idx + Make sure Buyer1 has returned ETH in balance
    ================================================================================================
    `)
    /*
     * SUB TEST 1: clearAuction
     */ 
    log(`
    BUYER1 GNO BALANCE = ${(await getBalance(buyer1, gno)).toEth()}
    BUYER1 ETH BALANCE = ${(await getBalance(buyer1, eth)).toEth()}
    `)
    // just to close auction
    log(`
    New Auction Index -> ${await getAuctionIndex()}
    `)
    assert.equal((await getBalance(buyer1, gno)), startBal.startingGNO + sellVolumes, 'Buyer 1 has the returned value into GNO + original balance')
    assert.isAtLeast(await getAuctionIndex(), 2)
  })

  it('BUYER1: GNO --> ETH: Buyer can lock tokens and only unlock them 24 hours later', async () => {
    log(`
    ============================================
    T4: Buyer1 - Locking and Unlocking of Tokens
    ============================================
    `)
    /*
     * SUB TEST 1: Try getting Tulips
     */ 
    // Claim Buyer Funds from auctionIdx 1
    await claimBuyerFunds(gno, eth, buyer1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(buyer1)
  })

  it('SELLER: GNO --> ETH: seller can lock tokens and only unlock them 24 hours later', async () => {
    log(`
    ============================================
    T5: Seller - Locking and Unlocking of Tokens
    ============================================
    `)
    log('seller BALANCE = ', (await getBalance(seller1, gno)).toEth())
    // await postBuyOrder(eth, gno, 1, 400..toWei(), buyer1)
    // just to close auction
    await claimSellerFunds(gno, eth, seller1, 1)
    // await checkUserReceivesTulipTokens(eth, gno, buyer1)
    await unlockTulipTokens(seller1)
  })
})

// conditionally start contracts
enableContractFlag(c1, c2, c3, c4, c5, c6, c7, c8)
