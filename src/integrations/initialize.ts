import { promisify } from 'api/utils'
import { ETHEREUM_NETWORKS } from './constants'
import { WalletProvider, ConnectedInterface } from './types'
import { Account, Balance } from 'types'

import MetamaskProvider from './metamask'
import ParityProvider from './parity'
import RemoteProvider from './remote'

const WATCHER_INTERVAL = 10000

const networkById = {
  1: ETHEREUM_NETWORKS.MAIN,
  2: ETHEREUM_NETWORKS.MORDEN,
  3: ETHEREUM_NETWORKS.ROPSTEN,
  4: ETHEREUM_NETWORKS.RINKEBY,
  42: ETHEREUM_NETWORKS.KOVAN,
}

const providers: WalletProvider[] = [
  MetamaskProvider,
  ParityProvider,
  RemoteProvider,
]

// compare object properties
const shallowDifferent = (obj1: object, obj2: object) => {
  if (!obj1 || !obj2) return true

  const keys1 = Object.keys(obj1)
  const keys2 = Object.keys(obj2)

  if (keys1.length !== keys2.length) return true

  return keys1.some(key => obj1[key] !== obj2[key])
}

export default async ({ registerProvider, updateProvider }: ConnectedInterface) => {

  const getAccount = async (provider: WalletProvider): Promise<Account> => {
    const [account] = await promisify(provider.web3.eth.getAccounts, provider.web3.eth)()

    return account
  }


  const getNetwork = async (provider: WalletProvider): Promise<ETHEREUM_NETWORKS> => {
    const networkId = await promisify(provider.web3.version.getNetwork, provider.web3.version)()
    return networkById[networkId] || ETHEREUM_NETWORKS.UNKNOWN
  }

  const getBalance = async (provider: WalletProvider, account: Account): Promise<Balance> => {

    const balance = await promisify(provider.web3.eth.getBalance, provider.web3.eth)(account)

    return provider.web3.fromWei(balance, 'ether').toString()
  }

  const watcher = async (provider: WalletProvider) => {
    if (!provider.checkAvailability()) return

    try {
      const [account, network] = await Promise.all<Account, ETHEREUM_NETWORKS>([
        getAccount(provider),
        getNetwork(provider),
      ])

      // only get balance if accaount is not undefined
      const balance = account && await getBalance(provider, account)

      const available = !!(provider.walletAvailable && account)


      const newState = { account, network, balance, available }

      // if data changed
      if (shallowDifferent(provider.state, newState)) {
        // dispatch action with updated provider state
        updateProvider(provider.providerName, provider.state = newState)
      }
    } catch (err) {
      console.warn(err)
      // if error
      if (provider.walletAvailable) {
        // disable internal provider
        provider.state.available = false
        // and dispatch action with { available: false }
        updateProvider(provider.providerName, provider.state)
      }
    }
  }

  providers.forEach((provider) => {
    // each provider intializes by creating its own web3 instance if there is a corresponding currentProvider injected
    provider.initialize()
    // dispatch action to save provider name and proirity
    registerProvider(provider.providerName, { priority: provider.priority })
    // get account, balance, etc. state
    watcher(provider)
    // regularly refetch state
    setInterval(() => watcher(provider), WATCHER_INTERVAL)
  })
}
