import { useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { sendSingRequest, useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import styles from './SingModal.module.css'

/** 读取当前激活会话；新建会话（null）也允许点歌，会自动建会话 */
const useActiveSessionId = () => useChatStore((state) => state.activeId)

/** 点歌弹窗：输入歌名（或音频直链），提交后走唱歌通道生成翻唱 */
export const SingModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useTranslate()
  const activeId = useActiveSessionId()
  const [song, setSong] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时聚焦输入框，方便直接输入歌名
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  const submit = () => {
    const trimmed = song.trim()
    if (!trimmed) {
      return
    }
    const ok = sendSingRequest(activeId, trimmed)
    if (!ok) {
      showToast({ key: 'singBusyToast' })
      return
    }
    setSong('')
    onClose()
  }

  return (
    <Modal
      title={t('singModalTitle')}
      closable
      onClose={onClose}
      footer={
        <>
          <Button variant="outlined" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={song.trim() === ''} onClick={submit}>
            {t('singSubmit')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder={t('singSongPlaceholder')}
          spellCheck={false}
          value={song}
          onChange={(event) => setSong(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div className={styles.hint}>
          {t('singModalHint')}
          <button type="button" className={styles.link} onClick={() => openSettings('model')}>
            {t('singModalHintAction')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
