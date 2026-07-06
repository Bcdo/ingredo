import React from 'react';

import { PlaceholderScreen } from '../../components/PlaceholderScreen';
import { t } from '../../lib/i18n';

export default function ShopScreen() {
  return <PlaceholderScreen icon="basket-outline" message={t('placeholder.shop')} />;
}
