import { QueryParamService } from "@nethserver/ns8-ui-lib";

if (QueryParamService && QueryParamService.methods) {
  QueryParamService.methods.checkUrlChangeForApp = function (context, page) {
    const newUrl = window.parent.location.href;

    if (newUrl != context.currentUrl) {
      context.currentUrl = newUrl;
      const queryParams = this.getQueryParamsForApp();
      const requestedPage = queryParams.page || "status";

      const match = /#\/apps\/([a-zA-Z0-9_-]+)/.exec(
        window.parent.location.hash
      );
      const appInstance =
        match && match[1] ? match[1] : context.instanceName || "";
      context.$root.$emit("appNavigation", appInstance, requestedPage);

      if (requestedPage !== page) {
        window.dispatchEvent(
          new CustomEvent("changeRoute", {
            detail: requestedPage,
          })
        );
      } else {
        this.syncQueryParamsAndDataForApp(context);
      }
    }

    context.currentUrl = window.parent.location.href;
  };
}
