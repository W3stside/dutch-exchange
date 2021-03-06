import React, { Component, CSSProperties } from 'react'

import { connect } from 'react-redux'
import { closeModal, approveAndPostSellOrder } from 'actions'

import { history } from 'index'

import { State, Modal } from 'types'  

import * as Modals from 'components/Modals'

export interface ModalContainerProps extends Modal {
  activeProvider: any,
  children?: any,

  closeModal?: typeof closeModal,
  submitSellOrder?: typeof approveAndPostSellOrder,
}

const backdropActive: CSSProperties = {
  zIndex: 100,
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,

  backgroundColor: '#00000091',
}

const blurred: CSSProperties = {
  filter: 'blur(4px)',

  pointerEvents: 'none', userSelect: 'none',
}

const Aux = (props: any) => props.children

let unblock : Function

class ModalContainer extends Component<ModalContainerProps> {

  componentWillReceiveProps(nextProps: any) {
    const { isOpen } = this.props
    // if no changes
    if (nextProps.isOpen === isOpen) return
        
    // If MODAL is OPEN block movement
    if (nextProps.isOpen) {
      unblock = history.block(`Are you sure you want to leave this page? You have not yet confirmed or rejected your sell order.` as any)
    } else {
      // otherwise unblock
      unblock()
    }
  }

  renderSpecificModal = (): JSX.Element => {
    const { modalName, isOpen, ...rest } = this.props

    if (!isOpen) return null

    const Modal = Modals[modalName]
    if (!Modal) throw new Error('No correct modal')
    
    return (
      <div style={backdropActive}>
        <Modal {...rest}/>
      </div>
    )
  }
  
  render() {
    const { children, isOpen } = this.props

    return (
      <Aux>
        {isOpen ? <div style={blurred}>{children}</div> : children}
        {this.renderSpecificModal()}
      </Aux>
    )
  }
}

const mapState = ({
  blockchain,
  modal: { 
    modalName, 
    modalProps, 
    isOpen, 
  },
}: State) => ({
  activeProvider: blockchain.activeProvider,
  
  isOpen,
  modalName,
  modalProps,
})

export default connect<ModalContainerProps>(mapState, { closeModal, approveAndPostSellOrder })(ModalContainer)
