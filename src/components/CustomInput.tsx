import React, { FC } from 'react';
import { TextInput } from 'react-native-paper';
import type { Props } from 'react-native-paper/src/components/TextInput/TextInput';

export const CustomInput: FC<Props> = props => {
    return (
        <TextInput
            {...props}
            right={
                props.right ?? (props.value && <TextInput.Icon icon="close" onPress={() => props.onChangeText?.('')} />)
            }
        />
    );
};

CustomInput.defaultProps = {
    autoCapitalize: 'none',
    autoCorrect: false,
    mode: 'outlined',
};
