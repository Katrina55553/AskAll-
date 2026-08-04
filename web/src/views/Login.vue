<template>
  <div class="login-page">
    <el-card class="login-card">
      <h2 class="brand">AskAll</h2>
      <el-tabs v-model="mode" stretch>
        <el-tab-pane :label="$t('auth.login')" name="login" />
        <el-tab-pane :label="$t('auth.register')" name="register" />
      </el-tabs>
      <el-form @submit.prevent="submit">
        <el-form-item>
          <el-input
            v-model="username"
            :placeholder="$t('auth.username')"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            :placeholder="$t('auth.password')"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item v-if="mode === 'register'">
          <el-input
            v-model="confirmPassword"
            type="password"
            :placeholder="$t('auth.confirmPassword')"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button
          type="primary"
          style="width: 100%"
          :loading="loading"
          @click="submit"
        >
          {{ mode === "login" ? $t("auth.login") : $t("auth.register") }}
        </el-button>
      </el-form>
      <div class="lang-row">
        <el-dropdown @command="setLang">
          <span class="lang">{{ langLabel }}</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="zh-CN">简体中文</el-dropdown-item>
              <el-dropdown-item command="en-US">English</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStore } from "vuex";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { User, Lock } from "@element-plus/icons-vue";

const route = useRoute();
const router = useRouter();
const store = useStore();
const { t, locale } = useI18n();

const mode = ref("login");
const username = ref("");
const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);

const langLabel = computed(() => (locale.value === "zh-CN" ? "中文" : "EN"));

function setLang(lang) {
  locale.value = lang;
  localStorage.setItem("askall-lang", lang);
}

async function submit() {
  if (!username.value.trim() || !password.value) return;
  if (mode.value === "register" && password.value !== confirmPassword.value) {
    return ElMessage.error(t("auth.passwordMismatch"));
  }
  loading.value = true;
  try {
    await store.dispatch(mode.value, {
      username: username.value.trim(),
      password: password.value,
    });
    ElMessage.success(
      mode.value === "login" ? t("auth.loginSuccess") : t("auth.registerSuccess")
    );
    router.push(route.query.redirect || "/ask");
  } catch (e) {
    ElMessage.error(e.response?.data?.error || e.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-page {
  display: flex;
  justify-content: center;
  padding-top: 8vh;
}
.login-card {
  width: 380px;
}
.brand {
  text-align: center;
  color: #409eff;
  margin-top: 0;
}
.lang-row {
  text-align: center;
  margin-top: 16px;
}
.lang {
  cursor: pointer;
  color: #909399;
  font-size: 13px;
}
</style>
