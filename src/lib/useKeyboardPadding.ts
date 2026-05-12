// 안드로이드에서 키보드가 입력 필드를 가리는 문제 완화용 훅.
// KeyboardAvoidingView 의 behavior가 Android 에서는 잘 안 먹히는 경우가 많아,
// 키보드가 올라오면 직접 그 높이를 받아 ScrollView paddingBottom 에 더해
// 입력란 아래쪽을 스크롤로 노출 가능하게 해 준다.
//
// iOS 는 보통 KeyboardAvoidingView(behavior="padding") 가 잘 동작하므로
// 중복 패딩을 피하기 위해 0 을 반환한다. (필요 시 useKeyboardPadding({ allIos: true }) 로 강제)
import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardPadding(opts?: { allIos?: boolean }) {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const show = Keyboard.addListener(showEvt, (e) => {
      setHeight(e?.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (Platform.OS === "ios" && !opts?.allIos) return 0;
  return height;
}
