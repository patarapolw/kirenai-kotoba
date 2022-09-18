import '@oruga-ui/oruga-next/dist/oruga-full.css';
import './global.css';
import './plugins/fontawesome';

import { createApp } from 'vue';

import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import Oruga from '@oruga-ui/oruga-next';

import App from './App.vue';

createApp(App)
  .use(Oruga, {
    iconComponent: 'FontAwesomeIcon',
    iconPack: 'fas',
  })
  .component('FontAwesomeIcon', FontAwesomeIcon)
  .mount('#app');
