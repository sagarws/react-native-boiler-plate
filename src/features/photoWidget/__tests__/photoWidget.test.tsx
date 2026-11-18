import React from 'react';
import { Alert, type AlertButton } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import '@/i18n';
import PhotoWidgetEditScreen from '../screens/PhotoWidgetEditScreen';
import PhotoWidgetsScreen from '../screens/PhotoWidgetsScreen';
import { dragFocus, imagePlacement, photoLayout } from '../services/layout';
import { cleanWidget } from '../services/native.service';

let mockParams: Record<string, unknown> | undefined;
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
  useIsFocused: () => true,
}));
jest.mock('@/specs/NativePhotoWidget', () => ({
  __esModule: true,
  default: {
    list: jest.fn(),
    pickImage: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    discardImage: jest.fn(),
    requestPin: jest.fn(),
  },
}));
const native: Record<string, jest.Mock> = jest.requireMock(
  '@/specs/NativePhotoWidget',
).default;

// Same cases as android/.../photowidget/PhotoMathTest.kt.
describe('photo layout (mirrors the native renderer)', () => {
  it('fit shows the whole photo, letterboxed', () => {
    const l = photoLayout({
      imgW: 2000,
      imgH: 1000,
      boxW: 200,
      boxH: 200,
      mode: 'fit',
    });
    expect(l.src).toEqual({ left: 0, top: 0, width: 2000, height: 1000 });
    expect(l.dst).toEqual({ left: 0, top: 50, width: 200, height: 100 });
  });

  it('fill covers the frame from the centre', () => {
    const l = photoLayout({
      imgW: 2000,
      imgH: 1000,
      boxW: 200,
      boxH: 200,
      mode: 'fill',
    });
    expect(l.src).toEqual({ left: 500, top: 0, width: 1000, height: 1000 });
  });

  it('crop follows the focus point and zoom, inside the photo', () => {
    const left = photoLayout({
      imgW: 2000,
      imgH: 1000,
      boxW: 200,
      boxH: 200,
      mode: 'crop',
      focusX: 0,
    });
    expect(left.src.left).toBe(0);
    const zoomed = photoLayout({
      imgW: 2000,
      imgH: 1000,
      boxW: 200,
      boxH: 200,
      mode: 'crop',
      focusX: 0.75,
      focusY: 0.25,
      zoom: 2,
    });
    expect(zoomed.src).toEqual({ left: 1250, top: 0, width: 500, height: 500 });
  });

  it('centres a chosen shape inside the widget', () => {
    const l = photoLayout({
      imgW: 1000,
      imgH: 1000,
      boxW: 300,
      boxH: 300,
      mode: 'fill',
      frameW: 2,
      frameH: 1,
    });
    expect(l.frame).toEqual({ left: 0, top: 75, width: 300, height: 150 });
  });

  it('places the preview image so the visible part matches', () => {
    const l = photoLayout({
      imgW: 2000,
      imgH: 1000,
      boxW: 200,
      boxH: 200,
      mode: 'fill',
    });
    expect(imagePlacement(l, 2000, 1000)).toEqual({
      left: -100,
      top: 0,
      width: 400,
      height: 200,
    });
  });

  it('moves the crop focus opposite to the drag', () => {
    expect(dragFocus({ x: 0.5, y: 0.5 }, 40, -20, 400, 200)).toEqual({
      x: 0.4,
      y: 0.6,
    });
    expect(dragFocus({ x: 0.1, y: 0.5 }, 400, 0, 400, 200).x).toBe(0);
  });

  it('validates widgets from native', () => {
    expect(
      cleanWidget({
        id: 'a',
        image: '/x.jpg',
        mode: 'stretch',
        zoom: 9,
        frameW: 3,
        frameH: 0,
      }),
    ).toMatchObject({ mode: 'fill', zoom: 4, frameW: 0, frameH: 0 });
    expect(cleanWidget({ id: 'a' })).toBeNull();
  });
});

type Renderer = ReactTestRenderer.ReactTestRenderer;
const mounted: Renderer[] = [];
async function render(node: React.ReactElement) {
  let r: Renderer | undefined;
  await ReactTestRenderer.act(async () => {
    r = ReactTestRenderer.create(node);
  });
  mounted.push(r!);
  return r!;
}
const byId = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.type !== 'string')[0];
const has = (r: Renderer, id: string) =>
  r.root.findAll(n => n.props.testID === id).length > 0;
const text = (r: Renderer) =>
  r.root
    .findAll(n => (n.type as unknown) === 'Text')
    .map(n => n.children.filter(c => typeof c === 'string').join(''))
    .join('\n');
const press = (r: Renderer, id: string) =>
  ReactTestRenderer.act(async () => {
    await byId(r, id).props.onPress();
  });

const stored = {
  id: 'w1',
  name: 'Beach',
  image: '/data/files/photo_widgets/a.jpg',
  imgW: 2000,
  imgH: 1000,
  mode: 'fill',
  frameW: 0,
  frameH: 0,
  focusX: 0.5,
  focusY: 0.5,
  zoom: 1,
  corner: 16,
  updatedAt: 1,
  placed: 2,
};
const lastSaved = () =>
  JSON.parse(native.save.mock.calls[native.save.mock.calls.length - 1][0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = undefined;
  native.list.mockResolvedValue(
    JSON.stringify({ widgets: [stored], pinSupported: true }),
  );
  native.save.mockResolvedValue(true);
  native.remove.mockResolvedValue(true);
  native.requestPin.mockResolvedValue(true);
});
afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach(r => r.unmount());
  });
});

describe('Photo widgets list', () => {
  it('lists photo widgets with where they are placed', async () => {
    const r = await render(<PhotoWidgetsScreen />);
    expect(text(r)).toContain('Beach');
    expect(text(r)).toContain('On the home screen 2 times');
    await press(r, 'photo-w1');
    expect(mockNavigate).toHaveBeenCalledWith('PhotoWidgetEdit', {
      widgetId: 'w1',
    });
  });

  it('creates a new widget from a picked photo', async () => {
    native.list.mockResolvedValue(
      JSON.stringify({ widgets: [], pinSupported: true }),
    );
    native.pickImage.mockResolvedValue(
      JSON.stringify({
        path: '/data/files/photo_widgets/b.jpg',
        width: 800,
        height: 600,
      }),
    );
    const r = await render(<PhotoWidgetsScreen />);
    expect(has(r, 'photo-empty')).toBe(true);
    await press(r, 'photo-new');
    expect(lastSaved()).toMatchObject({
      name: 'Photo 1',
      image: '/data/files/photo_widgets/b.jpg',
      imgW: 800,
      mode: 'fill',
    });
    // `placed` is native-side only.
    expect(lastSaved().placed).toBeUndefined();
    expect(mockNavigate).toHaveBeenCalledWith('PhotoWidgetEdit', {
      widgetId: lastSaved().id,
    });
  });

  it('explains a photo that could not be read', async () => {
    native.pickImage.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'import_failed' }),
    );
    const r = await render(<PhotoWidgetsScreen />);
    await press(r, 'photo-new');
    expect(text(r)).toContain("Couldn't read that photo");
  });
});

describe('Photo widget editor', () => {
  beforeEach(() => {
    mockParams = { widgetId: 'w1' };
  });

  it('changes the display mode, shape, crop and corners, then saves', async () => {
    const r = await render(<PhotoWidgetEditScreen />);
    await ReactTestRenderer.act(async () => {
      byId(r, 'photo-shape').props.onChange('custom');
    });
    expect(text(r)).toContain('2 × 2 cells');
    await ReactTestRenderer.act(async () => {
      byId(r, 'photo-mode').props.onChange('crop');
    });
    await ReactTestRenderer.act(async () => {
      byId(r, 'photo-zoom').props.onChange(2);
      byId(r, 'photo-corners').props.onChange(8);
    });
    // The accessible resize action grows the shape.
    await ReactTestRenderer.act(async () => {
      byId(r, 'photo-resize-handle').props.onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(text(r)).toContain('3 × 3 cells');
    await press(r, 'photo-save');
    expect(lastSaved()).toMatchObject({
      id: 'w1',
      mode: 'crop',
      zoom: 2,
      corner: 8,
      frameW: 3,
      frameH: 3,
    });
    expect(text(r)).toContain('Saved.');
  });

  it('replaces the photo and adds the widget to the home screen', async () => {
    native.pickImage.mockResolvedValue(
      JSON.stringify({
        path: '/data/files/photo_widgets/c.jpg',
        width: 500,
        height: 500,
      }),
    );
    const r = await render(<PhotoWidgetEditScreen />);
    await press(r, 'photo-replace');
    await press(r, 'photo-pin');
    expect(lastSaved()).toMatchObject({
      image: '/data/files/photo_widgets/c.jpg',
      imgW: 500,
    });
    expect(native.requestPin).toHaveBeenCalledWith('w1');
    expect(text(r)).toContain('Confirm on the home screen');
  });

  it('discards an unsaved replacement photo when leaving', async () => {
    native.pickImage.mockResolvedValue(
      JSON.stringify({
        path: '/data/files/photo_widgets/d.jpg',
        width: 500,
        height: 500,
      }),
    );
    const r = await render(<PhotoWidgetEditScreen />);
    await press(r, 'photo-replace');
    await ReactTestRenderer.act(async () => {
      r.unmount();
    });
    mounted.splice(mounted.indexOf(r), 1);
    expect(native.discardImage).toHaveBeenCalledWith(
      '/data/files/photo_widgets/d.jpg',
    );
  });

  it('removes a widget after confirmation', async () => {
    const r = await render(<PhotoWidgetEditScreen />);
    const alert = jest.spyOn(Alert, 'alert');
    await press(r, 'photo-remove');
    expect(alert.mock.calls[0][1]).toContain('2 widgets');
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    await ReactTestRenderer.act(async () => {
      await buttons.find(b => b.style === 'destructive')?.onPress?.();
    });
    expect(native.remove).toHaveBeenCalledWith('w1');
    expect(mockGoBack).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('says so when the widget no longer exists', async () => {
    mockParams = { widgetId: 'gone' };
    const r = await render(<PhotoWidgetEditScreen />);
    expect(has(r, 'photo-missing')).toBe(true);
  });
});
