import "server-only";

// 네이버 DOM 셀렉터는 전부 여기 모은다. 아래 값은 전부 라이브에서 확인된 값이다.
// 네이버가 UI를 바꾸면 이 파일만 고치면 되도록 다른 곳에 셀렉터를 하드코딩하지 말 것.

export const smartEditor = {
  writeUrlTemplate: (blogId: string) => `https://blog.naver.com/${blogId}?Redirect=Write&`,
  mainFrameName: "mainFrame",
  continueWritingPopup: { cancelButton: "button.se-popup-button-cancel" },
  helpPanelCloseButton: "button.se-help-panel-close-button",
  bodyArea: ".se-components-wrap",
  titleArea: ".se-documentTitle .se-text-paragraph",
  bodyParagraph: ".se-component.se-text .se-text-paragraph",
  imageToolbarButton: "button.se-image-toolbar-button",
  librarySidebarCloseButton: "button.se-sidebar-close-button",
  quotation: {
    dropdownToggle: ".se-toolbar-item-insert-quotation button", // 2개 매칭, .nth(1) 사용
    underlineStyleButton: "button.se-toolbar-option-insert-quotation-quotation_underline-button", // 소제목용(4번째 스타일)
    cornerStyleButton: "button.se-toolbar-option-insert-quotation-quotation_corner-button", // 목차/사진텍스트용(6번째 스타일)
    component: ".se-component.se-quotation",
  },
  highlight: {
    toolbarButton: "button.se-background-color-toolbar-button",
    swatch: (hex: string) => `button.se-color-palette[data-color='${hex}']`,
    yellow: "#fff593",
  },
  bold: { toolbarButton: "button.se-bold-toolbar-button" },
  underline: { toolbarButton: "button.se-underline-toolbar-button" },
  align: {
    // class 아님! se-align-*-toolbar-button 클래스는 현재 정렬 상태에 따라 바뀐다.
    dropdownToggle: "button[data-name='align-drop-down-with-justify']",
    centerButton: "button.se-toolbar-option-align-center-button",
  },
  table: {
    insertButton: "button.se-table-toolbar-button",
    cell: "table td, table th", // 3x3 고정, Tab으로 이동 안 됨, 셀마다 개별 클릭
    component: ".se-component.se-table",
    cellBackgroundColorButton: "button.se-cell-background-color-toolbar-button",
    bodyRowGrey: "#f7f7f7",
  },
  place: {
    insertButton: "button.se-map-toolbar-button",
    searchInput: "input.react-autosuggest__input",
    searchButton: "button.se-place-search-button",
    resultItem: ".se-place-map-search-result-item",
    addButtonInResult: "button.se-place-add-button", // hover해야 보임, force click 필요
    confirmButton: "button.se-popup-button-confirm",
    popup: ".se-popup-placesMap",
    closeButton: ".se-popup-placesMap button.se-popup-close-button",
  },
  template: {
    toolbarButton: "button.se-template-toolbar-button",
    myTemplatesTabText: "내 템플릿",
    item: "a.se-doc-template",
  },
  saveDraftButton: "button[data-click-area='tpb.save']",
  publishOpenButton: "button[data-click-area='tpb.publish']",
  publishConfirmButton: "button[data-click-area='tpb*i.publish']",
  visibilityRadioLabel: {
    public: "label[for='open_public']",
    neighbor: "label[for='open_neighbor']",
    mutualNeighbor: "label[for='open_both_neighbor']",
    private: "label[for='open_private']",
  },
  tagInput: "input[placeholder='태그 입력 (최대 30개)']",
};

export const naverLogin = {
  loginUrl: "https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com",
  qrLoginUrl: "https://nid.naver.com/nidlogin.login?mode=qrcode&url=https%3A%2F%2Fwww.naver.com&locale=ko_KR&svctype=1",
  qrImage: "img[alt='QR Code']",
  qrNumber: "div.number",
  sessionCookie: "NID_SES",
  authCookie: "NID_AUT",
  myBlogUrl: "https://blog.naver.com/MyBlog.naver",
};

export const naverSearch = {
  // where=blog / where=view 는 VIEW 탭이라 같은 글이 중복되고 블로그 프로필 링크가 섞인다.
  blogTabUrl: (q: string) => `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(q)}`,
  newsUrl: (q: string) => `https://search.naver.com/search.naver?where=news&sm=tab_jum&query=${encodeURIComponent(q)}`,
  postLinkPattern: /^https?:\/\/(?:m\.)?blog\.naver\.com\/([\w-]+)\/(\d{6,})/,
};

export const naverPost = {
  url: (blogId: string, postNo: string) => `https://blog.naver.com/${blogId}/${postNo}`,
  rssUrl: (blogId: string) => `https://rss.blog.naver.com/${blogId}.xml`,
  postListUrl: (blogId: string) => `https://blog.naver.com/PostList.naver?blogId=${blogId}&categoryNo=0&currentPage=1`,
  mainFrameName: "mainFrame",
  mainContainer: ".se-main-container",
  imageNodes: ".se-image, img",
  tableNodes: "table",
  mapNodes: ".se-map, .se-placesMap",
  paragraph: ".se-text-paragraph",
  headingCandidates: ".se-quotation .se-text-paragraph, .se-section-title",
  title: ".se-title-text, .pcol1, .se-documentTitle",
};
