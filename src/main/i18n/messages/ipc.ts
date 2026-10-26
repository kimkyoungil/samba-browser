// IPC 핸들러 문구
import { defineMessages } from '../define'

export const ipcMessages = defineMessages({
  ko: {
    'ipc.imagesInvalid':
      '붙여 넣은 이미지를 보낼 수 없어요 (PNG·JPEG·WebP·GIF, 한 장 5MB, 최대 4장)',
    'ipc.filesInvalid':
      '첨부한 파일을 보낼 수 없어요 (글 파일 한 개 20만 자·합계 30만 자, PDF 10MB, 최대 5개)',
    'ipc.pageConfirm': '페이지 확인: {message}',
    'ipc.saveFolderOutsideHome': '저장 폴더는 홈 폴더 안에서만 지정할 수 있어요',
    'ipc.unknownSubscriptionProvider': '알 수 없는 구독 경로',
    'ipc.disconnectWhileRunning': '작업이 끝난 뒤에 연결을 해지할 수 있어요',
    'ipc.unknownAiProvider': '알 수 없는 AI 연결 경로',
    'ipc.unknownApiKeyVendor': '알 수 없는 API 키 제공자',
    'ipc.unknownTaskModel': '알 수 없는 작업 등급',
    'ipc.emptyModelName': '모델 이름이 비어 있음',
    'ipc.loginRequired': '로그인이 필요합니다',
    'ipc.agentBridgeBusy':
      '자동 작업(주문 처리)이 브라우저를 쓰는 중이라 지금은 실행할 수 없어요. 잠시 뒤 다시 보내 주세요',
    'ipc.invalidExtensionId': '확장 id 가 올바르지 않아요',
    'ipc.extensionNotListed': '목록에 없는 확장이에요',
    'ipc.extensionDisabled': '꺼져 있는 확장이에요',
    'ipc.extensionSessionNotFound': '확장이 올라간 세션을 찾지 못했어요',
    'ipc.chatTruncateBusy': '작업이 끝난 뒤에 고쳐 보내거나 다시 받을 수 있어요',
    'ipc.chatImportNotAside':
      'Aside 대화 내보내기 파일이 아니에요(대화방·말 머리줄을 찾지 못했어요)',
    'ipc.chatImportBusy': '이미 가져오는 중이에요'
  },
  en: {
    'ipc.imagesInvalid':
      'The pasted image cannot be sent (PNG, JPEG, WebP or GIF, 5MB each, up to 4)',
    'ipc.filesInvalid':
      'The attached files cannot be sent (text files 200k characters each, 300k in total, PDF 10MB, up to 5)',
    'ipc.pageConfirm': 'Page confirmation: {message}',
    'ipc.saveFolderOutsideHome': 'The save folder must be inside your home folder',
    'ipc.unknownSubscriptionProvider': 'Unknown subscription provider',
    'ipc.disconnectWhileRunning': 'You can disconnect after the current task finishes',
    'ipc.unknownAiProvider': 'Unknown AI connection',
    'ipc.unknownApiKeyVendor': 'Unknown API key provider',
    'ipc.unknownTaskModel': 'Unknown task tier',
    'ipc.emptyModelName': 'The model name is empty',
    'ipc.loginRequired': 'Please sign in first',
    'ipc.agentBridgeBusy':
      'An automated task (order processing) is using the browser right now. Please send it again in a moment',
    'ipc.invalidExtensionId': 'The extension id is invalid',
    'ipc.extensionNotListed': 'This extension is not in the list',
    'ipc.extensionDisabled': 'This extension is turned off',
    'ipc.extensionSessionNotFound': 'Could not find the session the extension is loaded in',
    'ipc.chatTruncateBusy': 'You can edit or regenerate after the current task finishes',
    'ipc.chatImportNotAside': 'This is not an Aside chat export (no chat or message headers found)',
    'ipc.chatImportBusy': 'An import is already running'
  }
})
