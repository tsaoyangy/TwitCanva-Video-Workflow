const liveFetch = globalThis.fetch;

globalThis.fetch = async function noLiveArkFetch(input, init) {
  const url = input instanceof Request ? input.url : String(input);
  if (["ark.cn-beijing.volces.com", "ark.ap-southeast.bytepluses.com"].includes(new URL(url).hostname)) {
    throw new Error("Contract tests must inject an Ark mock; live generation is forbidden");
  }
  return liveFetch(input, init);
};
