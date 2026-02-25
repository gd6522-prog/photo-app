import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  // 카카오 느낌: 시각 높이는 56 정도 + iOS 홈바만 아래로 흡수
  const baseHeight = 56;
  const bottomPad = Math.max(insets.bottom, 8); // 홈바 있는 기종은 그만큼, 없으면 8
  const height = baseHeight + (insets.bottom > 0 ? insets.bottom : 0);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#9CA3AF",

        // ✅ “위쪽으로 딱 붙는” 탭바
        tabBarStyle: {
          height,
          paddingTop: 4, // 위쪽 공간 최소
          paddingBottom: bottomPad, // 아래(홈바)만 처리
          borderTopWidth: 1,
          borderTopColor: "#E5E7EB",
          backgroundColor: "#FFFFFF",

          // ✅ 바닥에 딱 붙이기
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
        },

        // ✅ 라벨/아이콘 떠 보이지 않게
        tabBarLabelStyle: { fontSize: 12, fontWeight: "900", marginTop: 0 },
        tabBarIconStyle: { marginTop: 0 },

        // (선택) 키보드 올라오면 탭바 숨기고 싶으면 true
        // tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "메인",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "home" : "home-outline"} size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="upload"
        options={{
          title: "업로드",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "cloud-upload" : "cloud-upload-outline"} size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="photo-list"
        options={{
          title: "조회",
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? "images" : "images-outline"} size={size} color={color} />
          ),
        }}
      />

      {/* 탭에는 숨기되 라우팅은 되는 화면들 */}
      <Tabs.Screen name="approve" options={{ href: null }} />
      <Tabs.Screen name="hazard-reports" options={{ href: null }} />
      <Tabs.Screen name="attendance-admin" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}