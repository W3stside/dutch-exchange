import { TokensInterface, TransactionObject, ERC20Interface } from './types'
import { Account, Balance, TokenCode } from 'types'
import { promisedContractsMap } from './contracts'

export const promisedTokens = init()

async function init(): Promise<TokensInterface> {

  const contractsMap = await promisedContractsMap
  console.log(contractsMap)

  const getToken = (code: TokenCode) => {
    const token: ERC20Interface = contractsMap[`Token${code}`]

    if (!token) throw new Error(`No Token contract for ${code} token`)

    return token
  }

  const getTokenBalance = (code: TokenCode, account: Account) => getToken(code).balanceOf(account)

  const getTotalSupply = (code: TokenCode) => getToken(code).totalSupply()

  const transfer = (code: TokenCode, to: Account, value: Balance, tx: TransactionObject) =>
    getToken(code).transfer(to, value, tx)

  const transferFrom = (code: TokenCode, from: Account, to: Account, value: Balance, tx: TransactionObject) =>
    getToken(code).transferFrom(from, to, value, tx)

  const approve = (code: TokenCode, spender: Account, value: Balance, tx: TransactionObject) =>
    getToken(code).approve(spender, value, tx)

  const allowance = (code: TokenCode, owner: Account, spender: Account) =>
    getToken(code).allowance(owner, spender)

  const eth = contractsMap['TokenETH']
  
  const depositETH = (tx: TransactionObject & {value: TransactionObject['value']}) => eth.deposit(tx)

  const withdrawETH = (value: Balance, tx: TransactionObject) => eth.withdraw(value, tx)

  return {
    getTokenBalance,
    getTotalSupply,
    transfer,
    transferFrom,
    approve,
    allowance,

    depositETH,
    withdrawETH,
  }
}
