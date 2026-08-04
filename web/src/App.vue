<template>
  <el-config-provider :locale="elementLocale">
    <div class="app-container">
      <header class="app-header" v-if="!isAuthPage">
        <div class="brand" @click="$router.push('/')">AskAll</div>
        <nav class="nav">
          <router-link to="/ask">{{ $t("nav.ask") }}</router-link>
          <router-link to="/credentials">{{ $t("nav.credentials") }}</router-link>
          <router-link to="/history">{{ $t("nav.history") }}</router-link>
        </nav>
        <div class="header-right">
          <el-dropdown @command="setLang">
            <span class="lang-switch">{{ langLabel }}</span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="zh-CN">简体中文</el-dropdown-item>
                <el-dropdown-item command="en-US">English</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span class="username" v-if="user">{{ user.username }}</span>
          <el-button v-if="user" link type="danger" @click="logout">
            {{ $t("nav.logout") }}
          </el-button>
        </div>
      </header>
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
