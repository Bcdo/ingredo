import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { useState } from 'react';

import { CodeInput } from '../components/ui/CodeInput';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function Harness() {
  const [value, setValue] = useState('');
  return <CodeInput testID="code" value={value} onChangeText={setValue} />;
}

describe('CodeInput', () => {
  it('formats typing into ABC-DEF', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc');
    expect(screen.getByTestId('code').props.value).toBe('ABC-');
    fireEvent.changeText(screen.getByTestId('code'), 'ABC-def');
    expect(screen.getByTestId('code').props.value).toBe('ABC-DEF');
  });

  it('lets backspace cross the hyphen without re-adding it', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc');
    expect(screen.getByTestId('code').props.value).toBe('ABC-');
    fireEvent.changeText(screen.getByTestId('code'), 'ABC');
    expect(screen.getByTestId('code').props.value).toBe('ABC');
    fireEvent.changeText(screen.getByTestId('code'), 'AB');
    expect(screen.getByTestId('code').props.value).toBe('AB');
  });

  it('normalizes a paste', () => {
    render(<Harness />);
    fireEvent.changeText(screen.getByTestId('code'), 'abc def');
    expect(screen.getByTestId('code').props.value).toBe('ABC-DEF');
  });

  it('caps the rendered length at 7', () => {
    render(<Harness />);
    expect(screen.getByTestId('code').props.maxLength).toBe(7);
  });
});
