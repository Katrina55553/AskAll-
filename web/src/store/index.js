import { createStore } from "vuex";
import api from "../api";

export default createStore({
  state: {
    token: localStorage.getItem("askall-token") || "",
    user: JSON.parse(localStorage.getItem("askall-user") || "null"),
    bots: [],
  },
  mutations: {
    setAuth(state, { token, user }) {
      state.token = token;
      state.user = user;
      localStorage.setItem("askall-token", token);
      localStorage.setItem("askall-user", JSON.stringify(user));
    },
    clearAuth(state) {
      state.token = "";
      state.user = null;
      localStorage.removeItem("askall-token");
      localStorage.removeItem("askall-user");
    },
    setBots(state, bots) {
      state.bots = bots;
    },
  },
  actions: {
    async login({ commit }, payload) {
      const { data } = await api.post("/auth/login", payload);
      commit("setAuth", data);
    },
    async register({ commit }, payload) {
      const { data } = await api.post("/auth/register", payload);
      commit("setAuth", data);
    },
    logout({ commit }) {
      commit("clearAuth");
    },
    async fetchBots({ commit }) {
      const { data } = await api.get("/bots");
      commit("setBots", data.bots);
    },
  },
});
