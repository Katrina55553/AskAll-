<template>
  <el-config-provider :locale="elementLocale">
    <div class="app-container">
      <aside class="app-sidebar" v-if="!isAuthPage">
        <div class="brand" @click="$router.push('/')">
          <span class="brand-mark">A</span>
          <span class="brand-name">AskAll</span>
        </div>
        <nav class="nav">
          <router-link to="/ask" class="nav-item">
            <el-icon><ChatDotRound /></el-icon>
            <span>{{ $t("nav.ask") }}</span>
          </router-link>
          <router-link to="/credentials" class="nav-item">
            <el-icon><Key /></el-icon>
            <span>{{ $t("nav.credentials") }}</span>
          </router-link>
          <router-link to="/history" class="nav-item">
            <el-icon><Clock /></el-icon>
            <span>{{ $t("nav.history") }}</span>
          </router-link>
        </nav>
        <div class="sidebar-footer">
          <el-dropdown @command="setLang">
            <span class="lang-switch">
              <el-icon><Switch /></el-icon>
              <span>{{ langLabel }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="zh-CN">简体中文</el-dropdown-item>
                <el-dropdown-item command="en-US">English</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <template v-if="user">
            <el-divider class="footer-divider" />
            <div class="user-box">
              <el-icon><User /></el-icon>
              <span class="username">{{ user.username }}</span>
            </div>
            <el-button v-if="user" link type="danger" @click="logout">
              <el-icon><SwitchButton /></el-icon>
              <span class="logout-text">{{ $t("nav.logout") }}</span>
            </el-button>
          </template>
        </div>
      </aside>
      <main class="app-main">
        <router-view />
      </main>
    </div>
  </el-config-provider>
</template>

<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import {
  ChatDotRound,
  Key,
  Clock,
  Switch,
  SwitchButton,
  User,
} from "@element-plus/icons-vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import en from "element-plus/es/locale/lang/en";

const route = useRoute();
const router = useRouter();
const store = useStore();
const { locale } = useI18n();

const isAuthPage = computed(() => route.path === "/login");
const user = computed(() => store.state.user);
const elementLocale = computed(() => (locale.value === "zh-CN" ? zhCn : en));
const langLabel = computed(() => (locale.value === "zh-CN" ? "中文" : "EN"));

function setLang(lang) {
  locale.value = lang;
  localStorage.setItem("askall-lang", lang);
}

function logout() {
  store.dispatch("logout");
  router.push("/login");
}

locale.value = localStorage.getItem("askall-lang") || "zh-CN";
</script>
