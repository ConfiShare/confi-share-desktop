import { useApp } from '../store/AppContext';
import { ImportChooseModal } from './ImportChooseModal';
import { ImportConfirmModal } from './ImportConfirmModal';
import { ImportSuccessModal } from './ImportSuccessModal';
import { EnterAccessCodeModal } from './EnterAccessCodeModal';
import { ViewAccessCodeModal } from './ViewAccessCodeModal';
import { AccessRevokedModal } from './AccessRevokedModal';

export function ModalManager() {
  const { modal } = useApp();

  switch (modal.type) {
    case 'import_choose':
      return <ImportChooseModal />;
    case 'import_confirm':
      return <ImportConfirmModal />;
    case 'import_success':
      return <ImportSuccessModal />;
    case 'enter_access_code':
      return <EnterAccessCodeModal />;
    case 'view_access_code':
      return <ViewAccessCodeModal />;
    case 'access_revoked':
      return <AccessRevokedModal />;
    default:
      return null;
  }
}