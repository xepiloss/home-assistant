# Home Assistant Add-ons

Home Assistant에서 사용할 수 있는 개인 애드온 저장소입니다.

## Add-ons

### Commax Wallpad

Commax 월패드를 EW11 TCP 소켓으로 연동하는 애드온입니다.

- 조명, 난방, 환기, 대기전력 콘센트 제어
- 일괄소등 제어
- 주차 위치 및 차량 번호 센서
- CO2, PM2.5, PM10 공기질 센서
- 수도, 전기, 온수, 난방, 가스 검침 센서
- 이번 달 검침 사용량 센서

자세한 사용법은 [Commax Wallpad README](./CommaxAddon/README.md)를 참고하세요.

### Commax Wallpad Dev

배포 전 테스트용 개발 버전입니다.

일반 사용자는 안정 버전인 `Commax Wallpad`를 사용하는 것을 권장합니다.

## 설치

Home Assistant에서 이 저장소를 Add-on Store 저장소로 추가한 뒤 원하는 애드온을 설치합니다.

```text
https://github.com/xepiloss/home-assistant
```

## 주의사항

- 같은 EW11 장비를 사용하는 애드온을 동시에 실행하지 마세요.
- `Commax Wallpad`와 `Commax Wallpad Dev`를 동시에 실행하지 마세요.
- 개발 버전은 배포 전 테스트용으로 예고 없이 변경되거나 삭제될 수 있습니다.
