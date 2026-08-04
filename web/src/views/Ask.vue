<template>
  <div class="ask-page">
    <el-card>
      <el-input
        v-model="question"
        type="textarea"
        :rows="4"
        :placeholder="$t('ask.placeholder')"
      />
      <div class="input-row">
        <ImageUpload ref="imageUploadRef" @update:files="files = $event" />
      </div>
      <div class="input-row controls">
        <div class="summarizer-select">
          <span>{{ $t("ask.summarizer") }}:</span>
          <el-select v-model="summarizerBotId" style="width: 240px">
            <el-option
              v-for="bot in configuredBots"
              :key="bot.id"
              :label="bot.name"
              :value="bot.id"
            />
          </el-select>
        </div>
        <el-button
          type="primary"
          size="large"
          :loading="asking"
          :disabled="asking"
          @click="send"
        >
          {{ asking ? $t("ask.sending") : $t("ask.send") }}
        </el-button>
      </div>
    </el-card>

    <el-card class="selector-card">
      <BotSelector
        :bots="botsWithStatus"
        v-model:selected="selectedBotIds"
        :max="5"
      />
    </el-card>

    <ProgressPanel :items="progressItems" />
    <ResultPanel
      :summary="summary"
      :rounds="summaryRounds"
      :summarizing="summarizing"
      :answers="answers"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import api from "../api";
import store from "../store";
import BotSelector from "../components/BotSelector.vue";
import ImageUpload from "../components/ImageUpload.vue";
import ProgressPanel from "../components/ProgressPanel.vue";
import ResultPanel from "../components/ResultPanel.vue";

const { t } = useI18n();

const question = ref("");
const files = ref([]);
const selectedBotIds = ref([]);
const summarizerBotId = ref("");
const asking = ref(false);
const summarizing = ref(false);
const summary = ref("");
const summaryRounds = ref(0);
const answers = ref({}); // botId -> {botId, botName, status, answer, error, durationMs}
const progressMap = ref({}); // botId -> {botId, botName, status, durationMs}
const imageUploadRef = ref(null);

const credentialStatus = ref({}); // botId -> configured

const botsWithStatus = computed(() =>
  store.state.bots.map((b) => ({
    ...b,
    configured: !!credentialStatus.value[b.id],
  }))
);
const configuredBots = computed(() =>
  botsWithStatus.value.filter((b) => b.configured)
);
const progressItems = computed(() => Object.values(progressMap.value));

onMounted(async () => {
  await store.dispatch("fetchBots");
  const { data } = await api.get("/credentials");
  const map = {};
  for (const c of data.credentials) map[c.id] = c.configured;
  credentialStatus.value = map;
  if (configuredBots.value.length && !summarizerBotId.value) {
    const preferred =
      configuredBots.value.find((b) => b.id === "chatgpt-api") ||
      configuredBots.value[0];
    summarizerBotId.value = preferred.id;
  }
});

function resetRunState() {
  answers.value = {};
  progressMap.value = {};
  summary.value = "";
  summaryRounds.value = 0;
  summarizing.value = false;
}

async function send() {
  if (!question.value.trim()) return ElMessage.warning(t("ask.needQuestion"));
  if (!selectedBotIds.value.length)
    return ElMessage.warning(t("ask.needBots"));

  asking.value = true;
  resetRunState();

  try {
    const fd = new FormData();
    fd.append("question", question.value.trim());
    fd.append("botIds", JSON.stringify(selectedBotIds.value));
    if (summarizerBotId.value)
      fd.append("summarizerBotId", summarizerBotId.value);
    for (const f of files.value) fd.append("images", f);

    const { data } = await api.post("/ask", fd);
    openStream(data.taskId);
  } catch (e) {
    asking.value = false;
    ElMessage.error(e.response?.data?.error || e.message);
  }
}

function openStream(taskId) {
  const token = store.state.token;
  const es = new EventSource(
    `/api/ask/stream/${taskId}?token=${encodeURIComponent(token)}`
  );

  es.onmessage = (msg) => {
    const e = JSON.parse(msg.data);
    switch (e.type) {
      case "status":
        progressMap.value = {
          ...progressMap.value,
          [e.botId]: {
            botId: e.botId,
            botName: e.botName,
            status: e.status,
          },
        };
        break;
      case "answer":
      case "error": {
        progressMap.value = {
          ...progressMap.value,
          [e.botId]: {
            botId: e.botId,
            botName: e.botName,
            status: e.status,
            durationMs: e.durationMs,
          },
        };
        answers.value = {
          ...answers.value,
          [e.botId]: {
            botId: e.botId,
            botName: e.botName,
            status: e.status,
            answer: e.answer,
            error: e.error,
            durationMs: e.durationMs,
          },
        };
        break;
      }
      case "summary-start":
        summarizing.value = true;
        break;
      case "summary":
        summary.value = e.summary;
        summaryRounds.value = e.rounds;
        summarizing.value = false;
        break;
      case "summary-error":
        summarizing.value = false;
        ElMessage.error(e.error);
        break;
      case "done":
      case "fatal":
        asking.value = false;
        summarizing.value = false;
        es.close();
        break;
    }
  };
  es.onerror = () => {
    asking.value = false;
    summarizing.value = false;
    es.close();
  };
}
</script>

<style scoped>
.ask-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.input-row {
  margin-top: 12px;
}
.controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.summarizer-select {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #606266;
}
.selector-card :deep(.el-card__body) {
  padding-top: 12px;
}
</style>
