import { createRouter, createWebHistory } from "vue-router";
import store from "../store";

const routes = [
  { path: "/", redirect: "/ask" },
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/Login.vue"),
    meta: { public: true },
  },
  {
    path: "/ask",
    name: "Ask",
    component: () => import("../views/Ask.vue"),
  },
  {
    path: "/credentials",
    name: "Credentials",
    component: () => import("../views/CredentialManage.vue"),
  },
  {
    path: "/history",
    name: "History",
    component: () => import("../views/History.vue"),
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Route guard: redirect to /login when not authenticated
router.beforeEach((to) => {
  if (!to.meta.public && !store.state.token) {
    return { path: "/login", query: { redirect: to.fullPath } };
  }
  if (to.path === "/login" && store.state.token) {
    return { path: "/ask" };
  }
  return true;
});

export default router;
