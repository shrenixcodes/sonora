// Runs only in the YouTube Music page, before its player scripts.
(() => {
  if (location.hostname !== "music.youtube.com" || window.top !== window) return;

  // Player responses can contain ads inline rather than in separate requests.
  const removePlayerAds = (result) => {
    if (!result || typeof result !== "object") return result;
    const player = result.playerResponse && typeof result.playerResponse === "object"
      ? result.playerResponse
      : result;
    if (!("videoDetails" in player) && !("playabilityStatus" in player)) return result;
    try {
      for (const name of ["adPlacements", "playerAds", "adSlots"]) {
        if (Object.prototype.hasOwnProperty.call(player, name)) delete player[name];
      }
    } catch {
      // A page-provided reviver can return a frozen or proxy object.
    }
    return result;
  };

  const parse = JSON.parse;
  JSON.parse = function (...args) {
    return removePlayerAds(Reflect.apply(parse, this, args));
  };

  // Response.json() parses natively and does not call the page's JSON.parse.
  if (typeof Response !== "undefined" && Response.prototype.json) {
    const responseJson = Response.prototype.json;
    Response.prototype.json = function (...args) {
      return Reflect.apply(responseJson, this, args).then(removePlayerAds);
    };
  }
})();
