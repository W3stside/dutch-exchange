const DutchExchange = artifacts.require('./DutchExchange.sol')
const TokenETH = artifacts.require('./EtherToken.sol')
const TokenGNO = artifacts.require('./TokenGNO.sol')

const argv = require('minimist')(process.argv.slice(2), { string: 'a' })

/**
 * truffle exec trufflescripts/deposit.js
 * to deposit funds to DutchExchange contracts
 * @flags:
 * --seller                     as the seller
 * --buyer                      as the buyer
 * -a <address>                 as the given address
 * --eth <number>               ETH tokens
 * --gno <number>               GNO tokens
 */

module.exports = async () => {
  if (!(argv.eth || argv.gno) || !(argv.seller || argv.buyer || argv.a)) {
    console.warn('No tokens or accounts specified')
    return
  }

  const dx = await DutchExchange.deployed()
  const eth = await TokenETH.deployed()
  const gno = await TokenGNO.deployed()

  let account, accountName
  if (argv.a) account = accountName = argv.a
  else if (argv.seller) {
    [, account] = web3.eth.accounts
    accountName = 'Seller'
  } else {
    [, , account] = web3.eth.accounts
    accountName = 'Buyer'
  }

  const getBalances = acc => Promise.all([
    dx.balances(eth.address, acc),
    dx.balances(gno.address, acc),
  ]).then(res => res.map(n => n.toNumber()))

  console.log(`${accountName}`)

  let [accountETH, accountGNO] = await getBalances(account)
  console.log(`Was deposited:\t${accountETH}\tETH,\t${accountGNO}\tGNO`)


  if (argv.eth) {
    try {
      await eth.approve(dx.address, argv.eth, { from: account })
      await dx.deposit(eth.address, argv.eth, { from: account })
    } catch (error) {
      console.warn(error.message || error)
    }
  }

  if (argv.gno) {
    try {
      await gno.approve(dx.address, argv.gno, { from: account })
      await dx.deposit(gno.address, argv.gno, { from: account })
    } catch (error) {
      console.warn(error.message || error)
    }
  }

  [accountETH, accountGNO] = await getBalances(account)
  console.log(`Is deposited:\t${accountETH}\tETH,\t${accountGNO}\tGNO`)
}