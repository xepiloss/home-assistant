# Home Assistant Add-ons

Home Assistant에서 사용하는 커스텀 애드온 저장소입니다.

## 애드온

### Commax Wallpad Add-on

Commax 월패드를 Home Assistant에 연결하는 MQTT 애드온입니다.

- 조명, 난방, 환기, 대기전력 콘센트, 일괄소등 제어
- 수도, 전기, 온수, 난방, 가스 검침 센서
- 월간 검침 사용량 계산
- 주차 위치, 차량 번호, 실내/실외 공기질과 날씨 정보 연동
- 엘리베이터 호출 MQTT/RS485 모드 선택
- TCP 패킷 경계가 밀린 경우 가능한 상태 프레임 복구
- EW11 또는 호환 시리얼-이더넷 장비 사용

자세한 내용은 [CommaxAddon/README.md](CommaxAddon/README.md)를 참고하세요.

### LG PI485 Air Conditioner Add-on

LG PI485 에어컨을 EW11 RS485-to-TCP 브리지를 통해 Home Assistant에 연결하는 MQTT 애드온입니다.

- 실내기별 climate 엔티티 자동 등록
- 전원, 운전 모드, 목표 온도, 팬 모드, 스윙 모드 제어
- 배관 온도, 에러 코드, raw frame, 부하 계열 진단 센서
- 제어 명령 우선 큐와 상태 폴링
- 냉방 전용 기본 구성

PI485/LGAP 경로에서 확인되지 않은 0.5도 목표온도와 습도는 지원하지 않습니다.

자세한 내용은 [LgPi485Addon/README.md](LgPi485Addon/README.md)를 참고하세요.

## 설치

Home Assistant Add-on Store에서 이 저장소를 추가한 뒤 필요한 애드온을 설치합니다.

각 애드온의 MQTT, EW11, 장치별 설정은 해당 애드온 설정 화면과 하위 README를 기준으로 입력합니다.
