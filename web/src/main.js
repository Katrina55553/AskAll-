import { createApp } from "vue";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import App from "./App.vue";
import router from "./router";
import store from "./store";
import i18n from "./i18n";
import "./styles/index.css";

const app = createApp(App);
app.use(store);
app.use(router);
app.use(i18n);
app.use(ElementPlus);
app.mount("#app");
