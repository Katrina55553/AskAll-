import axios from "axios";
import store from "./store";
import router from "./router";

const api = axios.create({
  baseURL: "/api",
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  const token = store.state.token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response && err.response.status === 401) {
      store.dispatch("logout");
      if (router.currentRoute.value.path !== "/login") {
        router.push("/login");
      }
    }
    return Promise.reject(err);
  }
);

export default api;
