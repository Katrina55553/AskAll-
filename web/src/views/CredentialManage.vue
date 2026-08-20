<template>
  <div>
    <el-card>
      <template #header>
        <div class="header">
          <h3>{{ $t("credentials.title") }}</h3>
          <div class="header-actions">
            <el-button text type="primary" @click="openGuide()">
              <el-icon style="margin-right: 4px"><QuestionFilled /></el-icon>
              {{ $t("credentials.guideButton") }}
            </el-button>
            <el-input
              v-model="keyword"
              :placeholder="$t('common.loading') === '' ? '' : '搜索 / Search'"
              clearable
              style="width: 240px"
            />
          </div>
        </div>
      </template>

      <el-collapse v-model="activeGroups">
        <el-collapse-item
          v-for="group in groups"
          :key="group.key"
          :title="`${$t(`ask.groups.${group.key}`)} (${group.bots.length})`"
          :name="group.key"
        >
          <div
            v-for="bot in group.bots"
            :key="bot.id"
            class="cred-row"
          >
            <div class="cred-info">
              <span class="bot-name">{{ bot.name }}</span>
              <el-tag size="small" :type="bot.configured ? 'success' : 'info'">
                {{
                  bot.configured
                    ? $t("credentials.available")
                    : $t("credentials.unavailable")
                }}
              </el-tag>
              <el-tag size="small" effect="plain">
                {{
                  bot.credentialType === "cookie"
                    ? $t("credentials.cookie")
                    : $t("credentials.apiKey")
                }}
              </el-tag>
            </div>
            <div class="cred-actions">
              <el-tooltip
                v-if="bot.credentialType === 'cookie'"
                :content="$t('credentials.guideTooltip')"
                placement="top"
              >
                <el-button circle size="small" @click="openGuide(bot)">
                  <el-icon><QuestionFilled /></el-icon>
                </el-button>
              </el-tooltip>
              <el-input
                v-model="inputs[bot.id]"
                :placeholder="
                  bot.configured
                    ? $t('credentials.savedPlaceholder')
                    : bot.credentialType === 'cookie'
                      ? $t('credentials.cookie')
                      : $t('credentials.apiKey')
                "
                :type="visible[bot.id] ? 'text' : 'password'"
                autocomplete="new-password"
                style="width: 320px"
                clearable
              >
                <template #append>
                  <el-button @click="visible[bot.id] = !visible[bot.id]">
                    <el-icon><View v-if="!visible[bot.id]" /><Hide v-else /></el-icon>
                  </el-button>
                </template>
              </el-input>
              <el-button
                type="primary"
                :disabled="!inputs[bot.id]"
                @click="save(bot)"
              >
                {{ $t("credentials.save") }}
              </el-button>
              <el-button
                :disabled="!bot.configured"
                :loading="validating[bot.id]"
                @click="validate(bot)"
              >
                {{ $t("credentials.validate") }}
              </el-button>
              <el-button
                type="danger"
                :disabled="!bot.configured"
                @click="clear(bot)"
              >
                {{ $t("credentials.clear") }}
              </el-button>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <el-dialog
      v-model="guideVisible"
      :title="$t('credentials.guideTitle')"
      width="560px"
    >
      <div v-if="guideBot" class="guide-target">
        <span>{{ $t("credentials.guideFor") }}：</span>
        <strong>{{ guideBot.name }}</strong>
        <el-link
          v-if="guideBot.homepage"
          type="primary"
          :href="guideBot.homepage"
          target="_blank"
          style="margin-left: 8px"
        >
          {{ guideBot.homepage }}
          <el-icon style="margin-left: 2px"><TopRight /></el-icon>
        </el-link>
      </div>

      <el-alert
        v-if="guideBot && $te(`credentials.hints.${guideBot.id}`)"
        type="info"
        :closable="false"
        :title="$t(`credentials.hints.${guideBot.id}`)"
        style="margin-bottom: 12px"
      />

      <ol class="guide-steps">
        <li>
          <strong>{{ $t("credentials.guideStep1Title") }}</strong>
          <template v-if="guideBot && guideBot.homepage">
            <i18n-t keypath="credentials.guideStep1WithUrl" tag="span">
              <template #url>
                <el-link type="primary" :href="guideBot.homepage" target="_blank">
                  {{ guideBot.homepage }}
                </el-link>
              </template>
            </i18n-t>
          </template>
          <template v-else>{{ $t("credentials.guideStep1") }}</template>
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep2Title") }}</strong>
          {{ $t("credentials.guideStep2") }}
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep3Title") }}</strong>
          {{ $t("credentials.guideStep3") }}
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep4Title") }}</strong>
          {{ $t("credentials.guideStep4", { name: guideBotName }) }}
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep5Title") }}</strong>
          {{ $t("credentials.guideStep5", { domain: guideBotDomain }) }}
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep6Title") }}</strong>
          {{ $t("credentials.guideStep6") }}
        </li>
        <li>
          <strong>{{ $t("credentials.guideStep7Title") }}</strong>
          {{ $t("credentials.guideStep7", { name: guideBotName }) }}
        </li>
      </ol>

      <el-alert
        type="warning"
        :closable="false"
        :title="$t('credentials.guideTipsTitle')"
        class="guide-tips"
      >
        <ul>
          <li>{{ $t("credentials.guideTip1") }}</li>
          <li>{{ $t("credentials.guideTip2") }}</li>
          <li>{{ $t("credentials.guideTip3") }}</li>
        </ul>
      </el-alert>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { View, Hide, QuestionFilled, TopRight } from "@element-plus/icons-vue";
import { useI18n } from "vue-i18n";
import api from "../api";

const { t } = useI18n();
const bots = ref([]);
const inputs = reactive({});
const visible = reactive({});
const validating = reactive({});
const keyword = ref("");
const activeGroups = ref(["free", "api"]);
const guideVisible = ref(false);
const guideBot = ref(null);

function openGuide(bot) {
  guideBot.value = bot || null;
  guideVisible.value = true;
}

const guideBotName = computed(() => guideBot.value?.name || t("credentials.guideGenericName"));
const guideBotDomain = computed(() => {
  const url = guideBot.value?.homepage;
  if (!url) return t("credentials.guideGenericDomain");
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
});

const GROUP_ORDER = ["free", "api"];

const groups = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return GROUP_ORDER.map((key) => ({
    key,
    bots: bots.value.filter(
      (b) =>
        (b.tags || []).includes(key) &&
        (!kw || b.name.toLowerCase().includes(kw) || b.id.includes(kw))
    ),
  })).filter((g) => g.bots.length);
});

async function load() {
  const [{ data: botsData }, { data: credData }] = await Promise.all([
    api.get("/bots"),
    api.get("/credentials"),
  ]);
  const statusMap = {};
  for (const c of credData.credentials) statusMap[c.id] = c.configured;
  bots.value = botsData.bots.map((b) => ({
    ...b,
    configured: !!statusMap[b.id],
  }));
}

onMounted(load);

async function save(bot) {
  try {
    await api.put(`/credentials/${bot.id}`, { value: inputs[bot.id] });
    inputs[bot.id] = "";
    ElMessage.success(t("credentials.saveSuccess"));
    await load();
  } catch (e) {
    ElMessage.error(e.response?.data?.error || e.message);
  }
}

async function validate(bot) {
  validating[bot.id] = true;
  try {
    const { data } = await api.post(`/credentials/${bot.id}/validate`);
    if (data.ok) ElMessage.success(t("credentials.validateSuccess"));
    else
      ElMessage.error(
        `${t("credentials.validateFailed")}${data.error ? "：" + data.error : ""}`
      );
  } catch (e) {
    ElMessage.error(e.response?.data?.error || e.message);
  } finally {
    validating[bot.id] = false;
  }
}

async function clear(bot) {
  await ElMessageBox.confirm(t("history.deleteConfirm"), "", {
    confirmButtonText: t("common.confirm"),
    cancelButtonText: t("common.cancel"),
  });
  await api.delete(`/credentials/${bot.id}`);
  ElMessage.success(t("credentials.clearSuccess"));
  await load();
}
</script>

<style scoped>
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.header h3 {
  margin: 0;
}
.cred-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #ebeef5;
  flex-wrap: wrap;
  gap: 8px;
}
.cred-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 220px;
}
.bot-name {
  font-size: 14px;
}
.cred-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.guide-target {
  margin-bottom: 12px;
  padding: 8px 12px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 14px;
}
.guide-steps {
  margin: 0 0 16px;
  padding-left: 20px;
  line-height: 1.9;
  font-size: 14px;
}
.guide-tips ul {
  margin: 4px 0 0;
  padding-left: 18px;
  line-height: 1.8;
}
</style>
