import { emit, listen, once } from "@tauri-apps/api/event";
import { message } from "@tauri-apps/api/dialog";
import dayjs from "dayjs";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { sendMessageApi, getMyFollowLiveInfo, getLiveStatusApi } from "@/api/live";
import type { SendMessage, SetInterval } from "@/types";
import * as EVENTS from "@/constants/events";
import { chatGTPApi, getEmojiApi } from "@/api";
import { create_entry_sql, create_danmu_sql, create_gift_sql, sign_sql, formatUname } from "@/utils/initSQL";
import { reactive, ref, watch } from "vue";
import { Notify } from "quasar";
import { LOGIN_INFO, MANAGE } from "@/constants";
import { getStore, setStore } from "@/store";

type Key = keyof typeof MANAGE

export const connected = ref(false);
export const active = ref(false);
export const emojiList = ref<any[]>([]);

export const msgList = ref<Record<string, any>>([]);
export const emojiPopList = ref<Record<string, any>>([]);
// 获取表情包列表
const getEmojiList = async () => {
  const result = await getEmojiApi(manage.roomid);
  if (!result) return

  emojiList.value = result.data;
};

export const manage = reactive({
  roomid: await (getStore(MANAGE.roomid)) || '3796382',
  robotName: await (getStore(MANAGE.robotName)) || '闹闹',
  hostName: await (getStore(MANAGE.hostName)) || '条条',
  like: await (getStore(MANAGE.like)) || false,
  likeText: await (getStore(MANAGE.likeText)) || '感谢{user}的点赞',
  follow: await (getStore(MANAGE.follow)) || false,
  followText: await (getStore(MANAGE.followText)) || '感谢{user}关注{up}',
  gift: await (getStore(MANAGE.gift)) || false,
  giftText: await (getStore(MANAGE.giftText)) || '感谢{user}投喂的{gift}',
  welcome: await (getStore(MANAGE.welcome)) || false,
  welcomeText: await (getStore(MANAGE.welcomeText)) || '欢迎{user}来到{up}直播间',
  gptToken: await getStore(MANAGE.gptToken) || ''
});

// 更新store，做持久化
watch(manage, (val) => {
  const keys = Object.keys(MANAGE) as Key[]
  keys.forEach(async (key: Key) => {
    await setStore(MANAGE[key], val[key])
  })
})

const messages: string[] = [];
let liveTime = 0
let todayFans = 0;

const online = `${manage.hostName}的小管家${manage.robotName}上钟咯，给大家请安～`;
const offline = `${manage.robotName}要下线了，感谢大家的陪伴～`;

const welcome = [
  `欢迎新朋友们来到${manage.hostName}的直播间～`,
  `${manage.hostName}有才有德，有点帅，快来关注他吧～`,
  "发发弹幕，可以触发直播间好玩的互动功能哟～"
];

const intro = [
  `我是管家${manage.robotName}，我会和${manage.hostName}一起陪伴大家`,
  `可以在弹幕里@${manage.robotName}，和我聊天一起玩哦～`
];

const bossList = [
  {
    uid: "349931835",
    uname: "纯鱼子酱",
    nickname: "小王同学",
    text: ",作业写完了么？"
  },
  {
    uid: "677100107",
    uname: "犷吉",
    nickname: "犷吉姐姐",
    text: ",有没有给闹闹带糖啊？"
  },
  {
    uid: "409672400",
    uname: "cryingwatermelon",
    nickname: "西瓜姐姐",
    text: ",快来夸夸闹闹吧～"
  },
  {
    uid: "79589619",
    uname: "小co_hegk",
    nickname: "",
    text: "夸夸团上线啦，@{up}不要摸鱼啦～"
  }
];

const autoSlice = (str: string) => {
  const arr: string[] = [];
  if (str.length > 20) {
    arr.push(str.slice(0, 20));
    const newArr = autoSlice(str.slice(20, str.length));
    arr.push(...newArr);
  } else {
    arr.push(str);
  }
  return arr;
};

const onClock = (start: number) => {
  // 解析后是本地的时间
  const diff = dayjs().diff(dayjs(start * 1000));
  const minutes = Math.floor(diff / 1000 / 60);
  liveTime = minutes;

  const str: string[] = [];
  if (minutes % 60 === 0) {
    str.push(`今天已经直播了${minutes / 60}小时，@${manage.hostName}太棒了！`);
  }
  if (minutes % 40 === 0) {
    str.push(`@${manage.hostName}累不累啊？喝点水休息一会吧～`);
    if (minutes / 60 > 3) { str.push(`@${manage.hostName}今天好努力啊，继续加油吧！`); }
  }

  return str;
};

// 发送信息
export const sendMessage = (value: string, type = "0") => {
  const params: SendMessage = {
    dm_type: type,
    msg: value,
    roomid: manage.roomid
  };
  console.log(params.msg);
  const result = sendMessageApi({ ...params, isInitiative: true });
  return !!result;
};

// 进入人数每超过100，欢迎信息
const enter_num = ref(0);
let lastCount = 0;
watch(enter_num, (num) => {
  const diff = Date.now() - lastCount;
  if (num > 100 && diff > 1000 * 60 * 12) {
    if (!manage.welcome) return;
    messages.push(...welcome.concat(intro));
    enter_num.value = 0;
    lastCount = Date.now();
  };
});

const unlisteners: UnlistenFn[] = [];
const init_listener = async () => {
  // 清空监听
  unlisteners.forEach(unlisten => unlisten());
  unlisteners.length = 0;

  // 监听进入房间事件
  const entryListener = await listen(EVENTS.WELCOME_EVENT, (event) => {
    unlisteners.push(entryListener);

    const data = event.payload as Object[];
    data.forEach(async (item: any) => {
      if (!active.value) return;

      if (item.msg_type === "follow") {
        // 关注事件
        if (!manage.follow) return;
        const message = manage.followText.replaceAll('{user}', formatUname(item.uname)).replaceAll('{up}', manage.hostName);
        messages.push(...autoSlice(message));
      } else if (item.msg_type === "entry") {
        // 大佬欢迎词
        const boss = bossList.find(boss => boss.uid === "" + item.uid)
        if (boss) {
          const message = (boss.nickname + boss.text).replaceAll('{up}', formatUname(manage.hostName))
          messages.push(...autoSlice(message));
        }

        enter_num.value += 1;
        create_entry_sql(item);
      } else if (item.msg_type === "vip_entry") {
        // 舰长等VIP进入
        const str = item.copy_writing.replace(/<%|%>/g, " ");
        messages.push(...autoSlice(str));
      } else {
        console.log("其他进场触发", item);
      }
    });
  });

  // 监听弹幕事件
  const danmuListener = await listen(EVENTS.BARRAGE_MESSAGE_EVENT, (event) => {
    unlisteners.push(danmuListener);

    const data = event.payload as Object[]
    data.forEach(async (item: any) => {
      const { uname, message, isEmoji, uid, emoji } = item.barrage;
      message && !isEmoji && msgList.value.push({ uname, message });
      isEmoji && emojiPopList.value.push(emoji);
      if (!active.value) return;
      // 自动下线其他机器人
      if (uid === 3493116453587470 && uid !== parseInt(await getStore(LOGIN_INFO.uid))) {
        active.value = false;
        return
      }
      if (message && uid !== parseInt(await getStore(LOGIN_INFO.uid))) {
        if (message.includes(`@${manage.robotName}`)) {
          const question = message.replace(`@${manage.robotName}`, "").trim();
          if (question.includes("粉丝数") || question.includes("今日目标")) {
            const { by_room_ids } = await getLiveStatusApi(manage.roomid);
            const curFans = by_room_ids[manage.roomid].attention;
            messages.push(...autoSlice(`@${manage.hostName} 当前粉丝数${curFans}，今日已增长${curFans - todayFans}，冲～`));
            return;
          }
          // 主人命令
          if (uid === 405579368) {
            switch (question) {
              case '下线':
                active.value = false;
                return;
              case '上线':
                active.value = true;
                return;
            }
          }
          if (manage.gptToken === '') return
          const result = await chatGTPApi(question);
          if (!result) return;
          messages.push(...autoSlice(`@${formatUname(uname)}:${result}`));
        }
        message.includes("晚安") && messages.push(`晚安${formatUname(uname)}， 谢谢你的陪伴～`);
        message.includes("晚上好") && messages.push(`${formatUname(uname)}， 晚上好啊～`);
        if (message === "签到" || message === "打卡" || message === 'daka') {
          const res = await sign_sql({ uid, uname, roomid: manage.roomid });
          messages.push(...autoSlice(res));
        }
      }
      if (item.barrageType === "like") {
        // 点赞事件
        if (!manage.like) return;
        const message = manage.likeText.replaceAll('{user}', formatUname(item.uname)).replaceAll('{up}', manage.hostName);
        messages.push(...autoSlice(message));
      } else {
        !isEmoji && create_danmu_sql({ ...item, roomid: manage.roomid });
      }
    });
  });

  // 监听礼物事件
  const giftListener = await listen(EVENTS.GIFT_EVENT, (event) => {
    unlisteners.push(giftListener);

    if (!active.value) return;
    const data = event.payload as Object[];
    data.forEach(async (item: any) => {
      create_gift_sql({ ...item, roomid: manage.roomid });
      if (!manage.gift) return;
      const { uname, giftName, giftId } = item.barrage;
      const message = manage.giftText
        .replaceAll('{user}', formatUname(uname))
        .replaceAll('{up}', manage.hostName)
        .replaceAll('{gift}', giftName || "礼物")

      giftId !== 1 && messages.push(...autoSlice(message));
    });
  });

  // 监听直播开始事件
  const startListener = await listen(EVENTS.LIVE_START_EVENT, async (event) => {
    unlisteners.push(startListener);

    const data = event.payload as any;
    if (data.roomid === Number(manage.roomid)) {
      active.value = true;
      await message(`${manage.hostName}的直播开始了`, "直播通知");
    };
  });

  // 监听直播结束事件
  const stopListener = await listen(EVENTS.LIVE_END_EVENT, (event) => {
    unlisteners.push(stopListener);

    const data = event.payload as any;
    data.roomid === manage.roomid && (active.value = false);
  });
};

let msgInterval: SetInterval;
let clockInterval: SetInterval;

watch(active, async (value) => {
  messages.length = 0;
  if (value) {
    //  开播后轮询直到获取到直播间信息再上线
    let loopLimit = 20;
    const liveInfoIntever = setInterval(async () => {
      const roomInfo = await getMyFollowLiveInfo();
      const target = roomInfo.rooms.find((room: { roomid: number; }) => room.roomid === parseInt(manage.roomid));
      loopLimit -= 1;
      if (loopLimit === 0) clearInterval(liveInfoIntever);
      if (target !== undefined) {
        console.log("已得到直播间信息");
        clearInterval(liveInfoIntever);
        msgInterval = setInterval(() => {
          if (!active.value && messages.length === 0) {
            clearInterval(msgInterval);
            return;
          }
          const message = messages.shift();
          if (!message) return;
          sendMessage(message);
        }, 1000 * 4);

        messages.push(online);
        messages.push(...intro);
        // 获取当前的粉丝量
        const { by_room_ids } = await getLiveStatusApi(manage.roomid);
        todayFans = by_room_ids[manage.roomid].attention;
        messages.push(`@${manage.hostName} 开播当前粉丝数：${todayFans}`);

        clockInterval = setInterval(() => {
          messages.push(...onClock(target.liveTime));
        }, 1000 * 60);
      }
    }, 1000 * 3);
  } else {
    // 计算今日直播时间，增长粉丝数量
    messages.push(`@${manage.hostName}今日直播时长 ${liveTime}分钟`);
    messages.push(offline);
    clearInterval(clockInterval);
  }
});

export const stopWebsocket = () => {
  active.value = false;
  connected.value = false;
  msgList.value.length = 0;
  emojiPopList.value.length = 0;
  emit(EVENTS.CLOSE_WEBSOCKET_EVENT);
  unlisteners.forEach((unlistener) => unlistener());
  unlisteners.length = 0;
};

export const startWebsocket = async () => {
  if (isNaN(Number(manage.roomid))) {
    Notify.create("请输入正确的直播间号");
    manage.roomid = "";
    return;
  }
  if (!manage.hostName || !manage.robotName) {
    Notify.create("请输入主播名称和机器人名称");
    return;
  }
  // 获取直播间信息
  const { by_room_ids } = await getLiveStatusApi(manage.roomid);
  const roomid = Object.keys(by_room_ids)[0];
  if (!roomid) {
    Notify.create("直播间不存在");
    return;
  }
  emit(EVENTS.OPEN_WEBSOCKET_EVENT, { roomid });
  once(EVENTS.CONNECT_SUCCESS_EVENT, (event) => {
    Notify.create("直播间连接成功");
    connected.value = true;
    init_listener();
    getEmojiList()
  });
};
