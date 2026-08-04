<template>
  <div>
    <el-card>
      <template #header>
        <h3 class="title">{{ $t("history.title") }}</h3>
      </template>

      <el-empty v-if="!groups.length" :description="$t('history.empty')" />

      <div v-for="group in groups" :key="group.date" class="date-group">
        <h4 class="date-title">{{ group.date }}</h4>
        <div
          v-for="record in group.records"
          :key="record.id"
          class="record-row"
        >
          <div class="record-head" @click="toggle(record.id)">
            <span class="time">{{ record.created_at.slice(11, 16) }}</span>
            <span class="question">{{ record.question }}</span>
            <el-button
              type="danger"
              size="small"
              link
              @click.stop="remove(record.id)"
            >
              {{ $t("history.delete") }}
            </el-button>
          </div>
          <div v-if="expanded[record.id]" class="record-detail">
            <div v-if="detail[record.id]" class="detail-body">
              <p class="full-question">{{ detail[record.id].question }}</p>
              <div v-if="detail[record.id].summary" class="block">
                <h5>
                  {{ $t("result.summary") }}
                  <el-tag
                    v-if="detail[record.id].split_rounds > 1"
                    size="small"
                    type="warning"
                  >
                    {{
                      $t("result.splitRounds", {
                        rounds: detail[record.id].split_rounds,
                      })
                    }}
                  </el-tag>
                </h5>
                <div class="text">{{ detail[record.id].summary }}</div>
              </div>
              <div class="block">
                <h5>{{ $t("result.originalAnswers") }}</h5>
                <el-collapse>
                  <el-collapse-item
                    v-for="item in detail[record.id].answers"
                    :key="item.id"
                    :title="item.bot_name"
                    :name="item.id"
                  >
                    <div class="text" v-if="item.answer">{{ item.answer }}</div>
                    <el-alert
                      v-else
                      :title="item.error"
                      type="error"
                      :closable="false"
                    />
                  </el-collapse-item>
                </el-collapse>
              </div>
            </div>
            <el-skeleton v-else :rows="3" animated />
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import api from "../api";

const { t } = useI18n();
const records = ref([]);
const expanded = reactive({});
const detail = reactive({});

const groups = computed(() => {
  const map = new Map();
  for (const r of records.value) {
    const date = r.created_at.slice(0, 10);
    if (!map.has(date)) map.set(date, []);
    map.get(date).push(r);
  }
  return [...map.entries()].map(([date, recs]) => ({ date, records: recs }));
});

async function load() {
  const { data } = await api.get("/history");
  records.value = data.records;
}

onMounted(load);

async function toggle(id) {
  expanded[id] = !expanded[id];
  if (expanded[id] && !detail[id]) {
    const { data } = await api.get(`/history/${id}`);
    detail[id] = data;
  }
}

async function remove(id) {
  await ElMessageBox.confirm(t("history.deleteConfirm"), "", {
    confirmButtonText: t("common.confirm"),
    cancelButtonText: t("common.cancel"),
    type: "warning",
  });
  await api.delete(`/history/${id}`);
  await load();
}
</script>

<style scoped>
.title {
  margin: 0;
}
.date-group {
  margin-bottom: 16px;
}
.date-title {
  color: #909399;
  font-size: 13px;
  margin: 12px 0 6px;
}
.record-row {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  margin-bottom: 8px;
}
.record-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
}
.record-head:hover {
  background: #f5f7fa;
}
.time {
  color: #909399;
  font-size: 13px;
  flex-shrink: 0;
}
.question {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.record-detail {
  border-top: 1px solid #ebeef5;
  padding: 14px;
}
.full-question {
  font-weight: 600;
}
.block {
  margin-top: 12px;
}
.block h5 {
  margin: 0 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.7;
  max-height: 300px;
  overflow-y: auto;
}
</style>
